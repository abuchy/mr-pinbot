import { NextRequest } from 'next/server';
import { authenticatedDatabase, privateJson, sameOrigin } from '@/lib/api-auth';
import { parseShopMyLink, safePublicUrl } from '@/lib/content';
import { enrichFromAuthorizedSources } from '@/lib/enrichment';
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({error:'Request not allowed.'},403);
  try {
    const auth=await authenticatedDatabase(request);
    if(!auth) return privateJson({error:'Please sign in.'},401);
    const body=await request.text();
    if(body.length>6000) return privateJson({error:'Preview one link at a time.'},413);
    const input=JSON.parse(body),link=parseShopMyLink(input.affiliate_url);
    if(!link) return privateJson({error:'Enter a valid ShopMy affiliate link.'},400);
    const product_url=typeof input.product_url==='string'&&safePublicUrl(input.product_url)?input.product_url:'';
    const result=await enrichFromAuthorizedSources({...link,product_url},{product_url});
    return privateJson({...result,affiliate_url:link.affiliate_url,source_key:link.source_key});
  } catch { return privateJson({error:'Couldn’t check the link. It has not been saved; you can try again.'},503); }
}
