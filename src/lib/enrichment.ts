import "server-only";
import type { ParsedLink } from "./content";
// New adapters must have documented authorization and return field-level provenance.
// No redirect following, scraping, arbitrary URL fetches, or retailer metadata probing.
export type AuthorizedEnrichment = {
  provider: string;
  authorizationReference: string;
  fields: Partial<Record<"product_name" | "retailer" | "product_url" | "image_url", string>>;
};
export interface EnrichmentProvider {
  id: string;
  authorizationReference: string;
  enrich(link: ParsedLink, signal: AbortSignal): Promise<AuthorizedEnrichment | null>;
}
const providers: readonly EnrichmentProvider[] = [];
export async function enrichFromAuthorizedSources(link: ParsedLink) {
  for (const provider of providers) {
    if (!provider.authorizationReference) continue;
    try {
      const result = await provider.enrich(link, AbortSignal.timeout(5000));
      if (result) return result;
    } catch { /* An enrichment failure must never prevent saving the link. */ }
  }
  return null;
}
