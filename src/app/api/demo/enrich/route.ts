import {NextRequest} from 'next/server';
import {privateJson,sameOrigin} from '@/lib/api-auth';
import {AuthorizedRedirectResolver,PermittedPageProvider} from '@/lib/enrichment/adapters';
import {runPipeline} from '@/lib/enrichment/engine';
export const maxDuration=30;
export async function POST(request:NextRequest){
 if(!sameOrigin(request))return privateJson({error:'Request not allowed.'},403);
 try{
  const body=await request.text();if(body.length>1000)return privateJson({error:'Use the fixed demo link.'},400);
  const {url}=JSON.parse(body);
  const origin='https://pinbot.annabuchy.com',link=origin+'/demo/link';
  if(url!==link)return privateJson({error:'This public demo accepts only its own first-party test link. Use your private library for ShopMy links.'},400);
  const base={origin,authorizationReference:'First-party Mr. Pinbot demo routes, explicitly provided for this user-requested HTTP import demonstration',expiresAt:'2099-01-01',permitsShopMyDestination:true,imagesMayBeRepublished:true};
  const grants=[{...base,pathPrefix:'/demo/link',purpose:'redirect' as const},{...base,pathPrefix:'/demo/product',purpose:'metadata' as const}];
  const result=await runPipeline({affiliate_url:link,source_key:'first-party-demo',product_url:''},{},{resolvers:[new AuthorizedRedirectResolver(grants)],providers:[new PermittedPageProvider(grants)]});
  return privateJson({...result,affiliate_url:link});
 }catch{return privateJson({error:'The live HTTP demo could not reach its test product. Try again.'},503);}
}
