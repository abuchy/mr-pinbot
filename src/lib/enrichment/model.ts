export type Field = 'product_name' | 'product_description' | 'retailer' | 'product_url' | 'image_url';
export type Fields = Partial<Record<Field, string>>;
export type EnrichmentStatus = 'pending' | 'partial' | 'review_required' | 'manual' | 'enriched';
export type Attempt = { stage: 'resolution' | 'metadata'; source: string; code: string; message: string; at: string };
export type Provenance = { source: string; authorizationReference: string; retrievedAt: string; locator: string; method: string; confidence?: 'confirmed' | 'inferred' | 'candidate'; reviewReason?: string; imageUsagePermission?: boolean };
export type Report = { attempts: Attempt[]; checked_at: string; fields: Partial<Record<Field, Provenance>>; image_candidates?: {url:string;label:string;variantConfirmed:boolean}[] };
export type Result = { enrichment_status: EnrichmentStatus; enrichment_report: Report; suggestions: Fields };
export type Grant = { origin: string; pathPrefix: string; purpose: 'redirect' | 'metadata' | 'feed'; authorizationReference: string; expiresAt: string; imagesMayBeRepublished?: boolean; permitsShopMyDestination?: boolean };
export type ProductContext = { affiliate_url: string; source_key: string; product_url: string };
export interface Resolver {
  id: string;
  resolve(context: ProductContext): Promise<{ url?: string; attempts: Attempt[]; provenance?: Provenance }>;
}
export interface MetadataProvider {
  id: string;
  lookup(context: ProductContext): Promise<{ fields: Fields; provenance?: Provenance; fieldProvenance?: Partial<Record<Field, Provenance>>; imageCandidates?: {url:string;label:string;variantConfirmed:boolean}[]; attempts: Attempt[] }>;
}
export function attempt(stage: Attempt['stage'], source: string, code: string, message: string): Attempt { return { stage, source, code, message, at: new Date().toISOString() }; }
export function complete(fields: Fields) { return !!(fields.product_name && fields.retailer && fields.product_url && fields.image_url); }
