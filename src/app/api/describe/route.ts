import {NextRequest} from 'next/server';
import {authenticatedDatabase,privateJson,sameOrigin} from '@/lib/api-auth';
import {describeImage,DescriptionError} from '@/lib/description';
export const maxDuration=30;
export async function POST(request:NextRequest){
 if(!sameOrigin(request))return privateJson({error:'Request not allowed.'},403);
 try{
  if(!await authenticatedDatabase(request))return privateJson({error:'Please sign in.'},401);
  const body=await request.text();if(body.length>5000)return privateJson({error:'Image request too long.'},413);
  const input=JSON.parse(body);if(typeof input.image_url!=='string'||input.image_url.length>2048||typeof input.title!=='string'||input.title.length>300)return privateJson({error:'Check the image and title.'},400);
  return privateJson(await describeImage(input.image_url,input.title));
 }catch(error){return privateJson({error:error instanceof DescriptionError?error.message:'Image analysis is unavailable.',code:error instanceof DescriptionError?error.code:'vision_unavailable'},503);}
}
