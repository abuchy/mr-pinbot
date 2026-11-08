"use client";
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {safePublicUrl} from '@/lib/content';
import type {Fields} from '@/lib/enrichment/model';
type Values=Fields&{affiliate_url?:string;website_url?:string|null;description_is_manual?:boolean;description_image_url?:string};
type Describe=(image:string,title:string)=>Promise<{description:string;image_url:string}>;
export function ProductFields({values,onDescribe,onPending}:{values:Values;permission?:boolean;candidates?:{url:string;label:string}[];onDescribe?:Describe;onPending?:(value:boolean)=>void}){
 const [image,setImage]=useState(values.image_url||'');
 const [title,setTitle]=useState(values.product_name||'');
 const [description,setDescription]=useState(values.product_description||'');
 const [manual,setManual]=useState(!!values.product_description&&(values.description_is_manual??true));
 const [descriptionImage,setDescriptionImage]=useState(values.description_image_url||'');
 const [suggestion,setSuggestion]=useState<{description:string;image_url:string}|null>(null);
 const [status,setStatus]=useState('');
 const dirty=useRef(manual),last=useRef(descriptionImage),currentTitle=useRef(title);
 useEffect(()=>{
  if(!onDescribe||!image||!safePublicUrl(image)||last.current===image)return;
  onPending?.(true);
  let cancelled=false;setSuggestion(null);
  const timer=setTimeout(async()=>{
   onPending?.(true);setStatus('Describing this image…');
   try{
    const result=await onDescribe(image,currentTitle.current);
    if(cancelled)return;
    last.current=image;
    if(dirty.current){setSuggestion(result);setStatus('An image description is ready. Your writing is unchanged.');}
    else{setDescription(result.description);setDescriptionImage(image);setManual(false);setStatus('');}
   }catch(error){if(!cancelled)setStatus(error instanceof Error?error.message:'Image description is unavailable. Your writing is unchanged.');}
   finally{if(!cancelled)onPending?.(false);}
  },700);
  return()=>{cancelled=true;clearTimeout(timer);onPending?.(false);};
 },[image,onDescribe,onPending]);
 return <>
  <label className="field-label">Title<input name="product_name" value={title} onChange={e=>{currentTitle.current=e.target.value;setTitle(e.target.value);}} maxLength={300}/></label>
  <label className="field-label">Website<input name="website_url" type="url" defaultValue={values.website_url||values.affiliate_url||''} required maxLength={2048}/></label>
  <label className="field-label">Image URL<input name="image_url" type="url" value={image} onChange={e=>{last.current='';setImage(e.target.value);setSuggestion(null);}} maxLength={2048}/></label>
  {image&&<div className="review-image"><Image key={image} unoptimized width={220} height={220} src={image} alt="Product image preview" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.alt='Image could not load; check its URL.';}}/></div>}
  <label className="field-label">Description<textarea name="product_description" rows={4} value={description} onChange={e=>{dirty.current=true;setManual(true);setDescription(e.target.value);setStatus('Your edited description will be kept when the image changes.');}} maxLength={2000}/></label>
  <input type="hidden" name="description_is_manual" value={String(manual)}/><input type="hidden" name="description_image_url" value={descriptionImage}/>
  {onDescribe&&<p className="field-help">Automatic descriptions use your image and relevant Pinterest keywords.</p>}
  {status&&<p className="field-help" role="status">{status}</p>}
  {suggestion&&<div className="field-help"><p>{suggestion.description}</p><button type="button" className="inline-button" onClick={()=>{setDescription(suggestion.description);setDescriptionImage(suggestion.image_url);setManual(false);dirty.current=false;setSuggestion(null);setStatus('Image description applied.');}}>Use image description</button></div>}
 </>;
}
