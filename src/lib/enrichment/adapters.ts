import robotsParser from 'robots-parser';
import { authorizedRequest, grantFor, SourceError } from './http';
import { extractMetadata } from './metadata';
import { attempt, type Grant, type MetadataProvider, type ProductContext, type Provenance, type Resolver, type Fields } from './model';
const provenance = (source: string, grant: Grant, locator: string, method: string): Provenance => ({ source, authorizationReference: grant.authorizationReference, locator, method, imageUsagePermission:grant.imagesMayBeRepublished===true, retrievedAt: new Date().toISOString() });
export class EmbeddedDestinationResolver implements Resolver {
  id = 'embedded_destination';
  async resolve(context: ProductContext) {
    const link = new URL(context.affiliate_url);
    const target = /^\/apx\/[^/]+$/.test(link.pathname) ? link.searchParams.get('url') : null;
    if (!target) return { attempts: [attempt('resolution',this.id,'no_embedded_destination','The affiliate URL contains no retailer destination.')] };
    try { const u = new URL(target); if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error(); return { url:u.href, attempts:[attempt('resolution',this.id,'resolved','Read the retailer destination directly from the pasted URL, without contacting ShopMy.')], provenance:{source:this.id,authorizationReference:'User-supplied URL; local decoding only',locator:'url parameter',method:'URL decoding',retrievedAt:new Date().toISOString()} }; }
    catch { return { attempts:[attempt('resolution',this.id,'invalid_destination','The embedded destination is not a valid HTTPS product URL.')] }; }
  }
}
export class AuthorizedRedirectResolver implements Resolver {
  id = 'authorized_redirect';
  constructor(private grants: readonly Grant[], private signal = AbortSignal.timeout(8000)) {}
  async resolve(context: ProductContext) {
    let url = new URL(context.affiliate_url);
    const seen = new Set<string>();
    for (let hop=0;hop<5;hop++) {
      const grant = grantFor(url,'redirect',this.grants);
      if (!grant) return { attempts:[attempt('resolution',this.id,'resolution_permission_required','Metadata pending: an authorized resolver is needed to identify this affiliate link’s retailer destination.')] };
      if (seen.has(url.href)) throw new SourceError('redirect_loop','The affiliate redirect repeats.');
      seen.add(url.href);
      const res = await authorizedRequest(url,'redirect',this.grants,{head:true,signal:this.signal});
      if (res.status === 403 || res.status === 401) throw new SourceError('source_restricted','The source declined access. No workaround was attempted.');
      if (res.status === 429) throw new SourceError('rate_limited','The source rate-limited this lookup. Retry later.');
      if (res.status < 300 || res.status >=400 || !res.location) throw new SourceError('destination_unavailable','The authorized resolver did not return a destination.');
      const next = new URL(res.location,url);
      if (next.protocol !== 'https:' || next.username || next.password || next.port) throw new SourceError('unsafe_destination','The redirect destination is not supported.');
      // An explicitly permitted retailer page is an endpoint. Do not request it here.
      if (grantFor(next,'metadata',this.grants) || !grantFor(next,'redirect',this.grants)) return { url:next.href,attempts:[attempt('resolution',this.id,'resolved','Read the destination from an authorized redirect response.')],provenance:provenance(this.id,grant,url.origin+url.pathname,'HTTP Location') };
      url=next;
    }
    throw new SourceError('redirect_limit','The redirect chain exceeded five permitted hops.');
  }
}
export class PermittedPageProvider implements MetadataProvider {
  id = 'permitted_page';
  constructor(private grants: readonly Grant[], private signal = AbortSignal.timeout(8000)) {}
  async lookup(context: ProductContext) {
    if (!context.product_url) return {fields:{},attempts:[]};
    const url = new URL(context.product_url), grant = grantFor(url,'metadata',this.grants);
    if (!grant && (url.hostname==='klassyshop.com'||url.hostname==='www.klassyshop.com')) return {fields:{},attempts:[attempt('metadata',this.id,'retailer_access_restricted','Klassy’s published terms prohibit automated website access. The product URL was resolved, but title and image retrieval need an allowed source.')]};
    if (!grant) return {fields:{},attempts:[attempt('metadata',this.id,'metadata_permission_required','The retailer page has no approved automated-access permission. A permitted API or feed can still supply details.')]};
    if (!grant.permitsShopMyDestination) return {fields:{},attempts:[attempt('metadata',this.id,'license_scope_required','The source’s permission must cover using its metadata with the original ShopMy destination.')]};
    const robots = await authorizedRequest(new URL('/robots.txt',url),'metadata',this.grants,{robots:true,signal:this.signal});
    if (robots.status !== 404 && (robots.status !== 200 || robotsParser(new URL('/robots.txt',url).href,robots.body).isAllowed(url.href,'MrPinbot') !== true)) throw new SourceError('blocked_by_robots','The retailer’s robots rules block this request or could not be verified.');
    const res = await authorizedRequest(url,'metadata',this.grants,{signal:this.signal});
    if (res.status === 429) throw new SourceError('rate_limited','The retailer rate-limited this lookup. Retry later.');
    if (res.status === 403 || res.status === 401) throw new SourceError('source_restricted','The retailer declined automated access.');
    if (res.status !== 200 || !res.contentType.includes('text/html')) throw new SourceError('metadata_unavailable','No permitted HTML product response was available.');
    const parsed = extractMetadata(res.body,url.href);
    if (parsed.method === 'Blocked page') throw new SourceError('source_restricted', 'The retailer returned an access-block page instead of product details.');
    // A permitted metadata image can be saved as a reference without asserting a publishing license.
    return {fields:parsed.fields,provenance:provenance(this.id,grant,url.origin+url.pathname,parsed.method),attempts:[attempt('metadata',this.id,'metadata_found','Read available product metadata from a permitted page; review the details before use.')]};
  }
}
export type LicensedRecord = { affiliate_url?: string; source_key?: string; product_url?: string; product_name?: string; retailer?: string; image_url?: string };
export type LicensedFeed = { id:string; authorizationReference:string; expiresAt:string; permitsShopMyDestination:boolean; imagesMayBeRepublished:boolean; records:LicensedRecord[] };
// Normalized feed adapter: merchant/network feeds can be transformed server-side
// into this contract. Never infer product identity from a fuzzy name search.
export class LicensedFeedProvider implements MetadataProvider {
  id: string;
  constructor(private feed: LicensedFeed) { this.id=feed.id; }
  async lookup(context: ProductContext) {
    if (!this.feed.authorizationReference || !(Date.parse(this.feed.expiresAt)>Date.now()) || !this.feed.permitsShopMyDestination) return {fields:{},attempts:[attempt('metadata',this.id,'license_scope_required','This product feed needs current permission for use with ShopMy destination links.')]};
    const matches=this.feed.records.filter(record => record.source_key===context.source_key || record.affiliate_url===context.affiliate_url || (context.product_url && record.product_url===context.product_url));
    if (matches.length!==1) return {fields:{},attempts:[attempt('metadata',this.id,matches.length?'ambiguous_match':'no_match',matches.length?'More than one feed item matched; no product was selected.':'No exact product match in the authorized feed. A retailer URL or product identifier may be needed.')]};
    const record=matches[0];
    const fields:Fields={product_name:record.product_name,retailer:record.retailer,product_url:record.product_url};
    if (this.feed.imagesMayBeRepublished) fields.image_url=record.image_url;
    return {fields,provenance:{source:this.id,authorizationReference:this.feed.authorizationReference,retrievedAt:new Date().toISOString(),locator:record.product_url || context.source_key,method:'Exact licensed feed match',imageUsagePermission:this.feed.imagesMayBeRepublished===true},attempts:[attempt('metadata',this.id,'metadata_found','Found an exact match in an authorized product feed. Review before use.')]};
  }
}
