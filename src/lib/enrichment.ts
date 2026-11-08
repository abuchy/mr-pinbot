import 'server-only';
import { EmbeddedDestinationResolver, AuthorizedRedirectResolver, PermittedPageProvider, LicensedFeedProvider, type LicensedFeed } from './enrichment/adapters';
import type { Fields, Grant, ProductContext } from './enrichment/model';
import { runPipeline } from './enrichment/engine';
export function configuredPipeline() {
  let grants: Grant[] = [], feeds: LicensedFeed[] = [];
  // Only deployment configuration can grant access. User-pasted content cannot.
  // Empty/malformed configuration fails closed; no default ShopMy/retailer grants.
  try { const value=JSON.parse(process.env.PINBOT_ENRICHMENT_GRANTS || '[]'); if(Array.isArray(value)) grants=value.filter(g=>g&&typeof g.origin==='string'&&typeof g.authorizationReference==='string'&&typeof g.pathPrefix==='string'&&typeof g.expiresAt==='string'); } catch { /* no grants */ }
  try { const value=JSON.parse(process.env.PINBOT_LICENSED_PRODUCT_FEEDS || '[]'); if(Array.isArray(value)) feeds=value.filter(f=>f&&typeof f.id==='string'&&typeof f.authorizationReference==='string'&&typeof f.expiresAt==='string'&&Array.isArray(f.records)); } catch { /* no feeds */ }
  return {resolvers:[new EmbeddedDestinationResolver(),new AuthorizedRedirectResolver(grants)],providers:[...feeds.map(feed=>new LicensedFeedProvider(feed)),new PermittedPageProvider(grants)]};
}
export async function enrichFromAuthorizedSources(context: ProductContext, current: Fields = {}) { return runPipeline(context,current,configuredPipeline()); }
