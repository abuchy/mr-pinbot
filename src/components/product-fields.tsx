"use client";
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {safePublicUrl} from '@/lib/content';
import type {Fields} from '@/lib/enrichment/model';
type Values=Fields&{affiliate_url?:string;website_url?:string|null;description_is_manual?:boolean;description_image_url?:string;image_notice?:string;original_image_url?:string};
type Describe=(image:string,title:string)=>Promise<{description:string;image_url:string}>;
export function ProductFields({values,onDescribe,onHostImage,onHosting,onPending,onChanges}:{values:Values;permission?:boolean;candidates?:{url:string;label:string}[];onDescribe?:Describe;onHostImage?:(url:string,title:string)=>Promise<{image_url:string;original_image_url:string}>;onHosting?:(pending:boolean)=>void;onPending?:(value:boolean)=>void;onChanges?:(changed:boolean)=>void}){
 const [image,setImage]=useState(values.image_url||'');
 const initialWebsite=values.website_url||values.affiliate_url||'';
 const [website,setWebsite]=useState(initialWebsite);
 const [title,setTitle]=useState(values.product_name||'');
 const [description,setDescription]=useState(values.product_description||'');
 const [manual,setManual]=useState(!!values.product_description&&(values.description_is_manual??true));
 const [descriptionImage,setDescriptionImage]=useState(values.description_image_url||'');
 const [suggestion,setSuggestion]=useState<{description:string;image_url:string}|null>(null);
 const [originalImage,setOriginalImage]=useState(values.original_image_url||'');
 const [hosting,setHosting]=useState(false);
 const [imageNotice,setImageNotice]=useState(values.image_notice||'');
 const currentImage=useRef(values.image_url||'');
 const [status,setStatus]=useState('');
 const dirty=useRef(manual),last=useRef(descriptionImage),currentTitle=useRef(title);
 const hasChanges=title.trim()!==(values.product_name||'').trim()
  || website.trim()!==initialWebsite.trim()
  || image.trim()!==(values.image_url||'').trim()
  || description.trim()!==(values.product_description||'').trim();
 useEffect(()=>{
  onChanges?.(hasChanges);
 },[hasChanges,onChanges]);
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
  <label className="field-label">Website<input name="website_url" type="url" value={website} onChange={event=>setWebsite(event.target.value)} required maxLength={2048}/></label>
  <label className="field-label">Image URL<input name="image_url" type="url" value={image} onChange={e=>{currentImage.current=e.target.value;last.current='';setImage(e.target.value);setSuggestion(null);setImageNotice('');setOriginalImage('');}} maxLength={2048}/></label>
  {imageNotice&&<p className="field-help" role="status">{imageNotice}</p>}
  {onHostImage&&image&&(!image.includes('/storage/v1/object/public/product-images/')||imageNotice)&&<button type="button" className="inline-button" disabled={hosting} onClick={async()=>{
    setHosting(true);onHosting?.(true);setImageNotice('');
    const selected=image;
    try{
      const result=await onHostImage(image.includes('/storage/v1/object/public/product-images/')?(values.original_image_url||image):image,title);
      if(currentImage.current===selected){
        if(descriptionImage===selected){last.current=result.image_url;setDescriptionImage(result.image_url);}
        currentImage.current=result.image_url;setImage(result.image_url);setOriginalImage(result.original_image_url);
      }
    }catch(error){setImageNotice(error instanceof Error?error.message:'Image storage is unavailable.');}
    finally{setHosting(false);onHosting?.(false);}
  }}>{hosting?'Storing image…':imageNotice?'Retry image storage':'Store image in library'}</button>}
  {image&&<div className="review-image"><Image key={image} unoptimized width={220} height={220} src={image} alt="Product image preview" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.alt='Image could not load; check its URL.';if(onHostImage)setImageNotice('The image could not load. Check the URL or retry storage.');}}/></div>}
  <label className="field-label">Description<textarea name="product_description" rows={4} value={description} onChange={e=>{dirty.current=true;setManual(true);setDescription(e.target.value);}} maxLength={2000}/></label>
  <input type="hidden" name="original_image_url" value={originalImage}/>
  <input type="hidden" name="description_is_manual" value={String(manual)}/><input type="hidden" name="description_image_url" value={descriptionImage}/>
  {onDescribe&&<p className="field-help">Automatic descriptions use your image and relevant Pinterest keywords.</p>}
  {status&&<p className="field-help" role="status">{status}</p>}
  {suggestion&&<div className="field-help"><p>{suggestion.description}</p><button type="button" className="inline-button" onClick={()=>{setDescription(suggestion.description);setDescriptionImage(suggestion.image_url);setManual(false);dirty.current=false;setSuggestion(null);setStatus('Image description applied.');}}>Use image description</button></div>}
 </>;
}
