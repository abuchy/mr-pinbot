import {attempt, type Fields, type MetadataProvider, type ProductContext, type Provenance} from './model';
import {SourceError} from './http';
import {safePublicUrl} from '../content';
export type SearchHit={url:string;title:string;content?:string;images?:SearchImage[]};
export type SearchImage={url:string;title?:string;description?:string|null};
export type SearchResponse={results?:SearchHit[];images?:SearchImage[]};
const words=(value:string)=>value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g,' ').split(' ').filter(v=>v.length>2&&!['solid','shop','network','with','the','and','www','com'].includes(v));
function sameProduct(a:string,b:string){try{const x=new URL(a),y=new URL(b);return x.hostname.replace(/^www\./,'')===y.hostname.replace(/^www\./,'')&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,'');}catch{return false;}}
export function matchSearch(context:ProductContext,response:SearchResponse){
 const hits=(response.results||[]).filter(hit=>safePublicUrl(hit.url)&&sameProduct(hit.url,context.product_url));
 if(!hits.length)return {fields:{} as Fields,images:[] as SearchImage[],provenance:{} as Partial<Record<keyof Fields,Provenance>>};
 const hit=hits[0],url=new URL(context.product_url);
 const parts=hit.title.split(/\s+[–—|]\s+|\s+-\s+/);
 const title=parts[0].trim(),retailer=parts.length>1?parts[parts.length-1].trim():'';
 const now=new Date().toISOString();
 const base={source:'tavily_search',authorizationReference:'Tavily documented Search API; indexed result, not a direct retailer request',retrievedAt:now,locator:hit.url,method:'Exact retailer origin and product-path match'};
 const fields:Fields={product_name:title,product_description:(hit.content||'').slice(0,500),...(retailer?{retailer}:{})};
 const provenance:Partial<Record<keyof Fields,Provenance>>={product_name:{...base,confidence:'confirmed',reviewReason:'Confirmed product-page match. Color/size variant is not confirmed by the page title.'},retailer:{...base,confidence:'confirmed'},product_description:{...base,confidence:'candidate',reviewReason:'Search-result excerpt; review for stale prices or availability before use.'}};
 const tokens=words(title);
 const images=[...(response.images||[]),...(hit.images||[])].filter(image=>safePublicUrl(image.url)&&tokens.length>=2&&tokens.every(token=>words(`${image.title||''} ${image.description||''}`).includes(token)));
 const unique=images.filter((image,index)=>images.findIndex(other=>other.url===image.url)===index).slice(0,5);
 if(unique[0]){
  fields.image_url=unique[0].url;
  provenance.image_url={...base,confidence:'candidate',method:'Search-provider image result matching product name',reviewReason:`Product-family match: ${unique[0].title||unique[0].description||title}. Exact variant ${url.searchParams.get('variant')||'(unspecified)'} and image reuse permission are not verified.`};
 }
 return {fields,images:unique,provenance};
}
export class TavilySearchProvider implements MetadataProvider{
 id='tavily_search';
 constructor(private apiKey='',private http:typeof fetch=fetch){}
 async lookup(context:ProductContext){
  if(!context.product_url)return {fields:{},attempts:[attempt('metadata',this.id,'search_identity_missing','Search needs a retailer URL or product identity; no unrelated product was selected.')]};
  const url=new URL(context.product_url),slug=decodeURIComponent(url.pathname.split('/').filter(Boolean).pop()||'').replace(/[-_]+/g,' ');
  const queries=url.searchParams.get('variant')?[`site:${url.hostname}${url.pathname} "${url.searchParams.get('variant')}"`,`site:${url.hostname}${url.pathname} ${slug}`]:[`site:${url.hostname}${url.pathname} ${slug}`];
  const attempts=[];let matched:ReturnType<typeof matchSearch>|undefined;
  for(const query of queries){
   const response=await this.http('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json',...(this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{'X-Tavily-Access-Mode':'keyless'})},body:JSON.stringify({query,max_results:5,include_domains:[url.hostname],include_images:true,include_image_descriptions:true,include_raw_content:false,include_answer:false}),signal:AbortSignal.timeout(9000),redirect:'error'});
   if(response.status===429||response.status===432)throw new SourceError('search_rate_limited','Search-provider allowance reached. Add a Tavily API key as TAVILY_API_KEY in Vercel, then retry.');
   if(response.status===401||response.status===403)throw new SourceError('search_setup_required','Search access was declined. Configure a valid server-only TAVILY_API_KEY.');
   if(!response.ok)throw new SourceError('search_unavailable','The search provider is unavailable. Direct metadata results are preserved; try again later.');
   const text=await response.text();if(text.length>2_000_000)throw new SourceError('search_response_too_large','Search returned too much data.');
   matched=matchSearch(context,JSON.parse(text));
   if(matched.fields.product_name)break;
   attempts.push(attempt('metadata',this.id,'no_exact_variant_result','No exact variant-ID search match. Trying the resolved product page and slug next.'));
  }
  if(!matched?.fields.product_name)return {fields:{},attempts:[...attempts,attempt('metadata',this.id,'search_no_exact_match','Search found no matching retailer product path. Similar products were not substituted.')]};
  return {fields:matched.fields,fieldProvenance:matched.provenance,imageCandidates:matched.images.map(i=>({url:i.url,label:i.title||i.description||'Product-family image',variantConfirmed:false})),attempts:[...attempts,attempt('metadata',this.id,'search_product_match','Search identified the exact retailer product path. Title and retailer are populated; variant details need review.'),attempt('metadata',this.id,matched.fields.image_url?'image_candidate_found':'image_unverified',matched.fields.image_url?'A direct product-family image URL is available as a review candidate. Exact color/size and reuse permission are not verified.':'No reliably associated direct product image URL was returned. The image field remains blank.')]};
 }
}
