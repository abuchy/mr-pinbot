import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {SupabaseClient} from '@supabase/supabase-js';
import {safePublicUrl} from './content';
import {publicBinaryRequest} from './enrichment/http';
import type {Result} from './enrichment/model';

const bucketName='product-images';
type Asset={object_path:string;source_url:string;byte_size:number};

export function imageFilename(title:string,hash:string){
 const slug=title.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(word=>!['and','the','with','a','an'].includes(word)).join('-').slice(0,90).replace(/-+$/,'');
 return `${slug||'product'}-${hash.slice(0,10)}.webp`;
}

export async function optimizeProductImage(bytes:Buffer){
 if(!bytes.length||bytes.length>8_000_000)throw new Error('The source image exceeds the download limit.');
 const input=sharp(bytes,{limitInputPixels:24_000_000,failOn:'error'});
 const meta=await input.metadata();
 if(!meta.width||!meta.height||!['jpeg','png','webp'].includes(meta.format||'')||(meta.pages||1)>1)throw new Error('Use a static JPEG, PNG, or WebP image.');
 for(const size of [1500,1250,1000]){
  for(const quality of [85,77,68]){
   const output=await input.clone().rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer();
   if(output.length<=400_000)return output;
  }
 }
 throw new Error('This image could not be optimized below 400 KB.');
}

function objectPath(url:string){
 try{
  const candidate=new URL(url), project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'');
  const prefix='/storage/v1/object/public/product-images/';
  return candidate.origin===project.origin && candidate.pathname.startsWith(prefix)?decodeURIComponent(candidate.pathname.slice(prefix.length)):null;
 }catch{return null;}
}
export async function originalImageUrl(db:SupabaseClient,owner:string,url:string,original?:unknown){
 const path=objectPath(url);
 if(!path)return url;
 const {data,error}=await db.from('product_image_assets').select('source_url').eq('owner_id',owner).eq('object_path',path).maybeSingle();
 if(error)throw error;
 if(!data)return '';
 return typeof original==='string'&&original.length<=2048&&original&&safePublicUrl(original)&&!objectPath(original)?original:data.source_url;
}

class ProductImageError extends Error {
 constructor(readonly code: string, message: string, readonly detail?: string) {
  super(message);
 }
}

export function imageFailureCode(error: unknown) {
 return error instanceof ProductImageError ? error.code : 'image_storage_failed';
}

export async function storeProductImage(db:SupabaseClient,owner:string,source:string,title:string){
 if(!source||source.length>2048||!safePublicUrl(source))throw new Error('Use a public HTTPS image URL.');
 const bucket=db.storage.from(bucketName);
 const publicUrl=(asset:Asset)=>bucket.getPublicUrl(asset.object_path).data.publicUrl;
 const verified=async(asset:Asset)=>{
  const response=await fetch(publicUrl(asset),{method:'HEAD',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  return response.ok && response.headers.get('content-type')?.split(';')[0]==='image/webp' && Number(response.headers.get('content-length'))===asset.byte_size;
 };
 const path=objectPath(source);
 const assets=db.from('product_image_assets');
 const {data:cached,error}=await assets.select('object_path,source_url,byte_size').eq('owner_id',owner).eq(path?'object_path':'source_url',path||source).limit(1).maybeSingle();
 if(error)throw new ProductImageError('image_storage_lookup_failed', 'Image storage is unavailable. Retry from the Pin editor.', error.code);
 if(cached&&await verified(cached).catch(()=>false))return {image_url:publicUrl(cached),original_image_url:path?cached.source_url:source};
 if(path)throw new Error('The stored image is unavailable. Retry using its original image URL.');
 let bytes: Buffer;
 try {
  const response = await publicBinaryRequest(new URL(source), {
   maxBytes: 8_000_000, accept: 'image/webp,image/png,image/jpeg', imageOnly: true,
  });
  bytes = response.body;
 } catch (error) {
  throw new ProductImageError('image_download_failed', 'The source image could not be downloaded.',
   error instanceof Error && 'code' in error ? String(error.code) : undefined);
 }
 const hash = createHash('sha256').update(bytes).digest('hex');
 let optimized: Buffer;
 try {
  optimized = await optimizeProductImage(bytes);
 } catch {
  throw new ProductImageError('image_decode_failed', 'The source did not contain a usable product image.');
 }
 const asset={owner_id:owner,hash,object_path:`${owner}/${hash}/${imageFilename(title,hash)}`,source_url:source,byte_size:optimized.length};
 const {error:reservationError}=await assets.upsert(asset,{onConflict:'owner_id,hash',ignoreDuplicates:true});
 if(reservationError)throw new ProductImageError('image_storage_reservation_failed', 'Image storage could not reserve a file.', reservationError.code);
 const {data:reserved}=await assets.select('object_path,source_url,byte_size').eq('owner_id',owner).eq('hash',hash).single();
 if(!reserved)throw new Error('Image storage could not find the reserved file.');
 if(!await verified(reserved).catch(()=>false)){
  const {error: uploadError}=await bucket.upload(reserved.object_path,optimized,{contentType:'image/webp',cacheControl:'31536000',upsert:false});
  if(!await verified(reserved).catch(()=>false))throw new ProductImageError(uploadError ? 'image_storage_upload_failed' : 'image_storage_verification_failed', 'The upload could not be verified. Retry from the Pin editor.', uploadError?.name);
 }
 return {image_url:publicUrl(reserved),original_image_url:source};
}

export async function hostEnrichedImage(result:Result,db:SupabaseClient,owner:string):Promise<{ image_url?: string; original_image_url?: string; image_notice?: string; image_code?: string }>{
 const source=result.suggestions.image_url;
 if(!source)return {image_code:'image_metadata_missing',image_notice:result.enrichment_report.variant_review && !result.enrichment_report.variant?'No exact variant image was selected. Add the matching image URL to continue.':undefined};
 try{
  const stored=await storeProductImage(db,owner,source,result.suggestions.product_name||'Product');
  result.suggestions.image_url=stored.image_url;
  return stored;
 }catch(error){
  console.warn('[pinbot:image]', {code:imageFailureCode(error), host:new URL(source).hostname,
   detail:error instanceof ProductImageError ? error.detail : undefined});
  delete result.suggestions.image_url;
  return {original_image_url:source,image_code:imageFailureCode(error),image_notice:error instanceof Error?error.message:'Image storage is unavailable.'};
 }
}
