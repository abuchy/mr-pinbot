import {NextRequest} from 'next/server';
import {authenticatedDatabase,privateJson,sameOrigin} from '@/lib/api-auth';
import {storeProductImage} from '@/lib/product-images';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:NextRequest){
 if(!sameOrigin(request))return privateJson({error:'Request not allowed.'},403);
 try{
  const auth=await authenticatedDatabase(request);
  if(!auth)return privateJson({error:'Please sign in.'},401);
  const body=await request.text();
  if(body.length>5000)return privateJson({error:'Image request too long.'},413);
  const {image_url,title}=JSON.parse(body);
  if(typeof image_url!=='string'||typeof title!=='string'||title.length>300)return privateJson({error:'Check the image URL and title.'},400);
  return privateJson(await storeProductImage(auth.database,auth.user.id,image_url,title));
 }catch(error){return privateJson({error:error instanceof Error?error.message:'Image storage is unavailable.'},503);}
}
