"use client";
import {useState} from 'react';
import Image from 'next/image';
import type {Fields} from '@/lib/enrichment/model';
// Shared review fields for the private library and first-party HTTP demo.
export function ProductFields({values,permission=false}:{values:Fields;permission?:boolean}){
 const [image,setImage]=useState(values.image_url||'');
 return <><label className="field-label">Product name<input name="product_name" defaultValue={values.product_name||''} maxLength={300}/></label><label className="field-label">Retailer<input name="retailer" defaultValue={values.retailer||''} maxLength={150}/></label><label className="field-label">Product URL <span>(optional)</span><input name="product_url" type="url" defaultValue={values.product_url||''} maxLength={2048}/></label><label className="field-label">Image URL <span>(optional)</span><input name="image_url" type="url" value={image} onChange={event=>setImage(event.target.value)} maxLength={2048}/></label>{image&&permission&&<div className="review-image"><Image unoptimized width={220} height={220} src={image} alt="Imported product preview" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.alt='Image could not load; check the image URL.';}}/></div>}</>;
}
