import type {SupabaseClient} from '@supabase/supabase-js';
import {attempt,type ProductContext,type Variant,type MetadataProvider,type Grant} from './model';
import {authorizedRequest,grantFor} from './http';
import {safePublicUrl} from '../content';
export function variantId(url:string){try{return new URL(url).searchParams.get('variant')||'';}catch{return '';}}
export function productIdentity(value:string){const url=new URL(value);return url.origin+url.pathname.replace(/\/$/,'');}
export function variantTitle(title:string,label:string){return title.toLowerCase().includes(label.toLowerCase())?title:`${title} - ${label}`;}
// Read only the exact variant ID, never the first/default variant.
export function shopifyVariant(data:Record<string,unknown>,url:string):Variant|undefined{
 const id=variantId(url);if(!id||!Array.isArray(data.variants))return;
 const selected=data.variants.find((v:Record<string,unknown>)=>String(v.id)===id);
 if(!selected||typeof selected.title!=='string')return;
 const attributes:Record<string,string>={};
 if(Array.isArray(data.options))data.options.forEach((option,index)=>{const name=typeof option==='string'?option:option?.name;const value=selected[`option${index+1}`];if(typeof name==='string'&&typeof value==='string')attributes[name]=value;});
 const image=typeof selected.featured_image==='string'?selected.featured_image:selected.featured_image?.src;
 return {id,label:selected.title,attributes,source:'retailer_data',image_url:typeof image==='string'&&safePublicUrl(new URL(image,url).href)?new URL(image,url).href:undefined};
}
export class SavedVariantProvider implements MetadataProvider{
 id='saved_variant';constructor(private database:SupabaseClient){}
 async lookup(context:ProductContext){
  const id=variantId(context.product_url);if(!id||context.variant?.source==='retailer_data')return {fields:{},attempts:[]};
  const {data,error}=await this.database.from('product_variant_hints').select('product_title,label,attributes,image_url').eq('product_identity',productIdentity(context.product_url)).eq('variant_id',id).maybeSingle();
  if(error||!data)return {fields:{},attempts:[]};
  const variant:Variant={id,label:data.label,attributes:data.attributes,source:'user_confirmed',...(data.image_url?{image_url:data.image_url}:{})};
  return {fields:{product_name:variantTitle(data.product_title,variant.label)},variant,provenance:{source:this.id,authorizationReference:'Your explicit variant correction',retrievedAt:new Date().toISOString(),locator:context.product_url,method:'User-confirmed variant ID mapping',confidence:'inferred' as const},attempts:[attempt('metadata',this.id,'user_confirmed_variant','Variant label comes from your saved correction; it has not been independently verified against retailer data.')]};
 }
}
export class ShopifyVariantProvider implements MetadataProvider{
 id='shopify_variant';constructor(private grants:Grant[],private http=authorizedRequest){}
 async lookup(context:ProductContext){
  if(!context.product_url||!variantId(context.product_url))return {fields:{},attempts:[]};
  const url=new URL(context.product_url);if(!/\/products\/[^/]+\/?$/.test(url.pathname))return {fields:{},attempts:[]};
  url.pathname=url.pathname.replace(/\/$/,'')+'.js';url.search='';
  if(!grantFor(url,'metadata',this.grants))return {fields:{},attempts:[attempt('metadata',this.id,'variant_source_not_configured','Variant-specific retailer data is not available from a configured permitted source. Searching indexed variant information next.')]};
  const result=await this.http(url,'metadata',this.grants);
  if(result.status!==200)return {fields:{},attempts:[attempt('metadata',this.id,'variant_source_unavailable','The retailer did not return variant data; no default variant was substituted.')]};
  const data=JSON.parse(result.body),variant=shopifyVariant(data,context.product_url);
  if(!variant)return {fields:{},attempts:[attempt('metadata',this.id,'variant_not_found','The exact variant ID was not found in retailer data.')]};
  const provenance={source:this.id,authorizationReference:'Configured permitted Shopify Ajax Product API',retrievedAt:new Date().toISOString(),locator:url.href,method:'Exact variant ID match',confidence:'confirmed' as const};
  return {fields:{product_name:variantTitle(String(data.title||''),variant.label),...(variant.image_url?{image_url:variant.image_url}:{})},variant,provenance,attempts:[attempt('metadata',this.id,'variant_confirmed','Matched the exact selected variant and its associated image in retailer data.')]};
 }
}
