import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SavedVariantProvider,ShopifyVariantProvider} from './enrichment/variants';
import {TavilySearchProvider} from './enrichment/search';
import { ShopMyPublicLinkResolver } from './enrichment/shopmy-redirect';
import { EmbeddedDestinationResolver, AuthorizedRedirectResolver, PermittedPageProvider, LicensedFeedProvider, type LicensedFeed } from './enrichment/adapters';
import type { Fields, Grant, ProductContext } from './enrichment/model';
import { runPipeline } from './enrichment/engine';
export function configuredPipeline(database?:SupabaseClient) {
  let grants: Grant[] = [], feeds: LicensedFeed[] = [];
  // Only deployment configuration can grant access. User-pasted content cannot.
  // Empty/malformed configuration fails closed; no default ShopMy/retailer grants.
  try { const value=JSON.parse(process.env.PINBOT_ENRICHMENT_GRANTS || '[]'); if(Array.isArray(value)) grants=value.filter(g=>g&&typeof g.origin==='string'&&typeof g.authorizationReference==='string'&&typeof g.pathPrefix==='string'&&typeof g.expiresAt==='string'); } catch { /* no grants */ }
  try { const value=JSON.parse(process.env.PINBOT_LICENSED_PRODUCT_FEEDS || '[]'); if(Array.isArray(value)) feeds=value.filter(f=>f&&typeof f.id==='string'&&typeof f.authorizationReference==='string'&&typeof f.expiresAt==='string'&&Array.isArray(f.records)); } catch { /* no feeds */ }
  return {resolvers:[new EmbeddedDestinationResolver(),new ShopMyPublicLinkResolver(),new AuthorizedRedirectResolver(grants)],providers:[new ShopifyVariantProvider(grants),...(database?[new SavedVariantProvider(database)]:[]),...feeds.map(feed=>new LicensedFeedProvider(feed)),new PermittedPageProvider(grants),new TavilySearchProvider(process.env.TAVILY_API_KEY)]};
}
export async function enrichFromAuthorizedSources(context: ProductContext, current: Fields = {},database?:SupabaseClient) { const result=await runPipeline(context,current,configuredPipeline(database));
 // Pin descriptions come from the chosen image, never truncated retailer/search copy.
 delete result.suggestions.product_description;
 if(result.enrichment_report.variant?.source==='search_index')result.enrichment_report.variant_review='Variant identified in an indexed variant URL. Confirm its details before publishing.';
 if(result.enrichment_report.variant?.source==='user_confirmed')result.enrichment_report.variant_review='Colorway uses your saved correction. Image matching is checked separately; retailer variant data is not independently verified.';
 return result; }
