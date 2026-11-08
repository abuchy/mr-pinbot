import { load } from 'cheerio';
import type { Fields } from './model';
function text(value: unknown, limit: number) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function absolute(value: unknown, page: string) {
  try { const u = new URL(typeof value === 'string' ? value : '', page); return value && u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
// Pure parsing: no network, scripts, embedded resources, or image downloads.
export function extractMetadata(html: string, page: string): { fields: Fields; method: string } {
  const $ = load(html);
  const og = (name: string) => $(`meta[property="${name}"]`).first().attr('content') ?? '';
  const products: Record<string, unknown>[] = [];
  function visit(value: unknown, depth = 0) {
    if (depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.slice(0,100).forEach(v => visit(v,depth+1)); return; }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.includes('Product')) products.push(node);
    if (node['@graph']) visit(node['@graph'],depth+1);
    if (node.mainEntity) visit(node.mainEntity,depth+1);
  }
  $('script[type="application/ld+json"]').each((_i, el) => { try { visit(JSON.parse($(el).text())); } catch { /* malformed block does not hide valid Open Graph */ } });
  // Multiple products without an exact URL match are ambiguous: use page-level OG.
  const matches = products.filter(p => absolute(p.url, page) === page);
  const product = matches.length === 1 ? matches[0] : products.length === 1 ? products[0] : undefined;
  const imageValue = product?.image;
  const image = Array.isArray(imageValue) ? imageValue[0] : imageValue;
  const imageUrl = typeof image === 'object' && image ? (image as Record<string,unknown>).url : image;
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const seller = offers && typeof offers === 'object' ? (offers as Record<string,unknown>).seller : undefined;
  // Brand is not necessarily the retailer. Use seller/site name instead.
  const fields: Fields = { product_name: text(og('og:title') || product?.name,300), retailer: text((seller && typeof seller === 'object' ? (seller as Record<string,unknown>).name : '') || og('og:site_name'),150), product_url: page, image_url: absolute(og('og:image') || imageUrl,page) };
  return { fields, method: product ? 'Product JSON-LD + Open Graph' : 'Open Graph' };
}
