import {attempt, type Fields, type MetadataProvider, type ProductContext, type Provenance, type Variant} from './model';
import {isBlockedMetadata} from './blocked';
import {SourceError} from './http';
import {safePublicUrl} from '../content';
import {variantTitle} from './variants';
export type SearchHit={url:string;title:string;content?:string;images?:SearchImage[]};
export type SearchImage={url:string;title?:string;description?:string|null};
export type SearchResponse={results?:SearchHit[];images?:SearchImage[]};
const words=(value:string)=>value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g,' ').split(' ').filter(v=>v.length>2&&!['solid','shop','network','with','the','and','www','com'].includes(v));
function sameProduct(a:string,b:string){try{const x=new URL(a),y=new URL(b);return x.hostname.replace(/^www\./,'')===y.hostname.replace(/^www\./,'')&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,'');}catch{return false;}}
export function matchSearch(context:ProductContext,response:SearchResponse){
 const wanted=new URL(context.product_url).searchParams.get('variant');
 const hits=(response.results||[]).filter(hit=>!isBlockedMetadata(hit.title)&&safePublicUrl(hit.url)&&sameProduct(hit.url,context.product_url)&&(!wanted||!!context.variant||!new URL(hit.url).searchParams.get('variant')||new URL(hit.url).searchParams.get('variant')===wanted)).sort((a,b)=>Number(new URL(b.url).searchParams.get('variant')===wanted)-Number(new URL(a.url).searchParams.get('variant')===wanted));
 const url=new URL(context.product_url);
 // A color-specific catalog SKU can identify the parent title, but a parent
 // result cannot verify the selected color or supply its image.
 const sku=url.pathname.match(/\/(\d+)([A-Z0-9]+)\.html$/);
 const color=sku && url.searchParams.get(`dwvar_${sku[1]}${sku[2]}_color`);
 const parent=color===sku?.[2] && sku ? new URL(url.pathname.replace(sku[0],`/${sku[1]}.html`),url).href : '';
 const parentHit=!hits.length && parent ? response.results?.find(hit=>
   !isBlockedMetadata(hit.title) && sameProduct(hit.url,parent)) : undefined;
 if(!hits.length&&!parentHit)return {fields:{} as Fields,images:[] as SearchImage[],provenance:{} as Partial<Record<keyof Fields,Provenance>>};
 const hit=hits[0] ?? parentHit!;
 const parts=hit.title.split(/\s+[–—|]\s+|\s+-\s+/);
 const variant:Variant|undefined=context.variant||((wanted&&new URL(hit.url).searchParams.get('variant')===wanted&&parts.length>=3)?{id:wanted,label:parts.slice(1,-1).join(' - '),attributes:{},source:'search_index'}:undefined);
 const parentTitle=parts[0].trim(),title=variant?variantTitle(parentTitle,variant.label):parentTitle,retailer=parts.length>1?parts[parts.length-1].trim():'';
 const now=new Date().toISOString();
 const base={source:'tavily_search',authorizationReference:'Tavily documented Search API; indexed result, not a direct retailer request',retrievedAt:now,locator:hit.url,method:'Exact retailer origin and product-path match'};
 const fields:Fields={product_name:title,...(retailer?{retailer}:{})};
 const provenance:Partial<Record<keyof Fields,Provenance>>={product_name:{...base,confidence:variant?.source==='retailer_data'?'confirmed':'inferred',reviewReason:variant?'Product page matched; variant label uses saved evidence.':'Product page matched; exact color/size is not confirmed.'},retailer:{...base,confidence:'confirmed'},product_description:{...base,confidence:'candidate',reviewReason:'Search-result excerpt; review for stale prices or availability before use.'}};
 const tokens=words(parentTitle); const variantTokens=words(variant?.label||'');
 const images=[...(response.images||[]),...(hit.images||[])].filter(image=>safePublicUrl(image.url)&&tokens.length>=2&&tokens.every(token=>words(`${image.title||''} ${image.description||''}`).includes(token)));
 const selected=parentHit||color?[]:variantTokens.length?images.filter(image=>variantTokens.every(token=>words(`${image.title||''} ${image.description||''}`).includes(token))):url.searchParams.has('variant')?[]:images;
 const unique=selected.filter((image,index)=>selected.findIndex(other=>other.url===image.url)===index).slice(0,5);
 if(unique[0]){
  fields.image_url=unique[0].url;
  provenance.image_url={...base,confidence:'candidate',method:'Search-provider image result matching product name',reviewReason:`Image label matches: ${unique[0].title||unique[0].description||title}. ${variant?.source==='retailer_data'?'Colorway matched.':'Variant-ID mapping needs review; this is a search-index colorway match.'}`};
 }
 return {fields,images:unique,provenance,variant,parentOnly:!!parentHit};
}
export class TavilySearchProvider implements MetadataProvider{
 id='tavily_search';
 constructor(private apiKey='',private http:typeof fetch=fetch){}
 async lookup(context:ProductContext){
  if(!context.product_url)return {fields:{},attempts:[attempt('metadata',this.id,'search_identity_missing','Search needs a retailer URL or product identity; no unrelated product was selected.')]};
  const url=new URL(context.product_url),slug=decodeURIComponent(url.pathname.split('/').filter(Boolean).slice(-2).join(' ')).replace(/\.html$/i,'').replace(/[-_]+/g,' ');
  const colorQuery=context.variant?.label.split(/\s+and\s+/i).map(part=>`"${part.replaceAll('"','')}"`).join(' ');
  const queries=colorQuery?[`site:${url.hostname}${url.pathname} ${colorQuery}`,`site:${url.hostname} ${slug} ${colorQuery}`]:url.searchParams.get('variant')?[`site:${url.hostname}${url.pathname} "${url.searchParams.get('variant')}"`,`site:${url.hostname}${url.pathname} ${slug}`]:[`site:${url.hostname}${url.pathname} ${slug}`];
  const collected:SearchResponse={results:[],images:[]};
  const attempts=[];let matched:ReturnType<typeof matchSearch>|undefined;
  for(const query of queries){
   const response=await this.http('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json',...(this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{'X-Tavily-Access-Mode':'keyless'})},body:JSON.stringify({query,max_results:5,include_domains:[url.hostname],include_images:true,include_image_descriptions:true,include_raw_content:false,include_answer:false,search_depth:'advanced'}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(response.status===429||response.status===432)throw new SourceError('search_rate_limited','Search-provider allowance reached. Add a Tavily API key as TAVILY_API_KEY in Vercel, then retry.');
   if(response.status===401||response.status===403)throw new SourceError('search_setup_required','Search access was declined. Configure a valid server-only TAVILY_API_KEY.');
   if(!response.ok)throw new SourceError('search_unavailable','The search provider is unavailable. Direct metadata results are preserved; try again later.');
   const text=await response.text();if(text.length>2_000_000)throw new SourceError('search_response_too_large','Search returned too much data.');
   const payload=JSON.parse(text) as SearchResponse;
   const pages=(payload.results||[]).slice(0,3).map(hit=>safePublicUrl(hit.url)?hit.url:'').filter(Boolean);
   attempts.push(attempt('metadata',this.id,'search_result_summary',`Search returned ${payload.results?.length||0} pages. ${pages.length?'Sources checked: '+pages.join(' · '):'No indexed product pages were returned.'}`));
   attempts.push(attempt('metadata',this.id,'search_image_summary',`Image results: ${(payload.images||[]).slice(0,6).map(image=>`${image.title||image.description||'(no caption)'} [${image.url}]`).join(' · ')||'none'}`));
   collected.results!.push(...(payload.results||[]));collected.images!.push(...(payload.images||[]));
   const found=matchSearch(context,collected);
   if(found.fields.product_name)matched=found;
   if(found.fields.product_name&&found.fields.image_url)break;
   attempts.push(attempt('metadata',this.id,'search_query_incomplete','No complete product and image match from this query. Trying the next focused product search.'));
  }
  if(!matched?.fields.product_name)return {fields:{},attempts:[...attempts,attempt('metadata',this.id,'search_no_exact_match','Search found no matching retailer product path. Similar products were not substituted.')]};
  return {fields:matched.fields,variant:matched.variant,fieldProvenance:matched.provenance,imageCandidates:matched.images.map(i=>({url:i.url,label:i.title||i.description||'Product-family image',variantConfirmed:false})),attempts:[...attempts,attempt('metadata',this.id,'search_product_match',('parentOnly' in matched && matched.parentOnly) ? 'Search identified the parent product by SKU. Confirm the variant and add its image.' : 'Search identified the exact retailer product path. Title and retailer are populated; variant details need review.'),attempt('metadata',this.id,matched.fields.image_url?'image_candidate_found':'image_unverified',matched.fields.image_url?'An image label matches the selected colorway. Check the preview; retailer variant-ID-to-image mapping is not independently verified.':'No reliably associated direct product image URL was returned. The image field remains blank.')]};
 }
}
