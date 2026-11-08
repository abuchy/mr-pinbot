export const MAX_IMPORT_LINKS = 100;
export type ContentItem = {
  id: string;
  affiliate_url: string;
  source_key: string;
  product_name: string;
  product_description: string;
  retailer: string;
  product_url: string;
  image_url: string;
  image_rights_confirmed: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
  source: "pasted_link" | "official_shopmy_api" | "authorized_browser";
  enrichment_status: "pending" | "partial" | "review_required" | "manual" | "enriched";
  metadata_reviewed: boolean;
  enrichment_report: { attempts: { stage: string; source: string; code: string; message: string; at: string }[]; checked_at: string | null; image_candidates?: {url:string;label:string;variantConfirmed:boolean}[]; fields?: Record<string, { source: string; method: string; retrievedAt: string; confidence?: string; reviewReason?: string; imageUsagePermission?: boolean }> };
};
export type ParsedLink = { affiliate_url: string; source_key: string };
export type ImportPreview = { links: ParsedLink[]; invalid: string[]; duplicates: number };

// Only recognize the documented product affiliate-link format. Never resolve redirects.
export function parseShopMyLink(input: string): ParsedLink | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname !== "go.shopmy.us") return null;
    const match = /^\/p-([1-9][0-9]*)\/?$/.exec(url.pathname);
    if (match) return { affiliate_url: input.trim(), source_key: `shopmy:p-${match[1]}` };
    if (/^\/apx\/[^/]+$/.test(url.pathname)) {
      const destination = url.searchParams.get('url');
      if (!destination || !safePublicUrl(destination)) return null;
      const key = `shopmy:apx:${encodeURIComponent(url.pathname.split('/')[2])}:${encodeURIComponent(new URL(destination).href)}`;
      if (key.length > 1500) return null;
      return { affiliate_url: input.trim(), source_key: key };
    }
    return null;
  } catch { return null; }
}

export function previewImport(text: string): ImportPreview {
  if (text.length > 50000) throw new Error("Paste up to 100 links at a time (50,000 characters maximum).");
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error("Paste at least one ShopMy affiliate link.");
  if (tokens.length > MAX_IMPORT_LINKS) throw new Error("Paste up to 100 links at a time.");
  const links: ParsedLink[] = [], invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const token of tokens) {
    const link = parseShopMyLink(token);
    if (!link) invalid.push(token);
    else if (seen.has(link.source_key)) duplicates++;
    else { seen.add(link.source_key); links.push(link); }
  }
  return { links, invalid, duplicates };
}

export function safePublicUrl(input: string): boolean {
  if (!input) return true;
  try {
    const u = new URL(input);
    // Stored URLs are never fetched on the server. Reject obvious local targets anyway.
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      u.hostname.includes(".") && !u.hostname.endsWith(".local") &&
      !u.hostname.endsWith(".localhost") && !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(":");
  } catch { return false; }
}
export type ProductDetails = Record<'product_name'|'product_description'|'retailer'|'product_url'|'image_url'|'notes',string> & {image_rights_confirmed:boolean};
export function validateDetails(input: unknown): ProductDetails {
  if (!input || typeof input !== "object") throw new Error("Please check the product details.");
  const value = input as Record<string, unknown>;
  const limits = { product_name: 300, product_description:2000, retailer: 150, product_url: 2048, image_url: 2048, notes: 3000 };
  const result: Record<string, string> = {};
  for (const [key, limit] of Object.entries(limits)) {
    if(key==='product_description'&&value[key]===undefined){result[key]='';continue;}
    if (typeof value[key] !== "string" || value[key].length > limit) throw new Error(`Please check ${key.replaceAll("_", " ")}.`);
    result[key] = value[key].trim();
  }
  if (!safePublicUrl(result.product_url) || !safePublicUrl(result.image_url)) throw new Error("Use a public HTTPS address for product and image URLs.");
  if (typeof value.image_rights_confirmed !== "boolean") throw new Error("Please check image permission.");
  if (result.image_url && !value.image_rights_confirmed) throw new Error("Confirm permission to use the image, or leave the image address blank.");
  return { ...result, image_rights_confirmed: value.image_rights_confirmed } as ProductDetails;
}
