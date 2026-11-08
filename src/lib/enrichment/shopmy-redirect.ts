import { authorizedRequest, SourceError } from './http';
import { attempt, type ProductContext, type Resolver } from './model';
// One public navigation hop for an explicitly pasted product link. No account,
// cookies, redirect-click endpoint calls, dashboard, or background link discovery.
export class ShopMyPublicLinkResolver implements Resolver {
  id='shopmy_public_redirect';
  constructor(private http = authorizedRequest) {}
  async resolve(context:ProductContext){
    const input=new URL(context.affiliate_url);
    if(input.origin!=='https://go.shopmy.us'||!/^\/p-[1-9][0-9]*\/?$/.test(input.pathname))return {attempts:[]};
    const grants=[{origin:input.origin,pathPrefix:input.pathname,purpose:'redirect' as const,authorizationReference:'User-initiated public affiliate URL navigation; not an assertion of ShopMy API authorization',expiresAt:new Date(Date.now()+60000).toISOString()}];
    const res=await this.http(input,'redirect',grants,{head:true,signal:AbortSignal.timeout(7000)});
    if(res.status===401||res.status===403)throw new SourceError('source_restricted','The public affiliate endpoint declined access.');
    if(res.status===429)throw new SourceError('rate_limited','ShopMy rate-limited this lookup. Try again later.');
    if(res.status<300||res.status>=400||!res.location)throw new SourceError('destination_unavailable','The public link did not return an HTTP redirect.');
    const location=new URL(res.location,input);
    // The redirect response itself can expose a URL. Decode it as text; never
    // request ShopMy's intermediate API route or infer other API endpoints.
    const embedded=location.searchParams.get('url');
    const target=embedded?new URL(embedded):location;
    if(target.protocol!=='https:'||target.username||target.password||target.port||target.hostname==='shopmy.us'||target.hostname.endsWith('.shopmy.us'))throw new SourceError('destination_unavailable','The first redirect did not identify a retailer product URL.');
    return {url:target.href,attempts:[attempt('resolution',this.id,'resolved','Identified the retailer product URL from one public HTTP redirect. No intermediate API was called.')],provenance:{source:this.id,authorizationReference:grants[0].authorizationReference,retrievedAt:new Date().toISOString(),locator:input.origin+input.pathname,method:'HTTP HEAD Location; local destination decoding'}};
  }
}
