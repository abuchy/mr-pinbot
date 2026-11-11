import type {SupabaseClient} from '@supabase/supabase-js';
import {safePublicUrl} from './content';

export function objectPath(url:string){
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
