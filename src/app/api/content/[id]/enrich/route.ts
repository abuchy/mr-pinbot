import { NextRequest } from 'next/server';
import { authenticatedDatabase,privateJson,sameOrigin } from '@/lib/api-auth';
import { enrichFromAuthorizedSources } from '@/lib/enrichment';
export const maxDuration=60;
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!sameOrigin(request))return privateJson({error:'Request not allowed.'},403);
 try{
  const auth=await authenticatedDatabase(request);if(!auth)return privateJson({error:'Please sign in.'},401);
  const {id}=await params;
  const {data:item,error}=await auth.database.from('content_items').select('*').eq('id',id).eq('owner_id',auth.user.id).maybeSingle();
  if(error||!item)return privateJson({error:'Item not found.'},404);
  if(item.enrichment_report?.checked_at&&Date.now()-Date.parse(item.enrichment_report.checked_at)<30000)return privateJson({error:'Wait 30 seconds between checks for this product.'},429);
  const claimedAt=new Date().toISOString();
  const {data:claim,error:claimError}=await auth.database.from('content_items').update({updated_at:claimedAt,enrichment_report:{...item.enrichment_report,checked_at:claimedAt}}).eq('id',id).eq('owner_id',auth.user.id).eq('updated_at',item.updated_at).select('id').maybeSingle();
  if(claimError||!claim)return privateJson({error:'Another edit or lookup is already in progress. Refresh before retrying.'},409);
  const result=await enrichFromAuthorizedSources(item,item);
        // Search images are review candidates, never an automatic license to publish.
        if(result.suggestions.image_url&&!item.image_rights_confirmed&&result.enrichment_report.fields.image_url?.imageUsagePermission!==true){
          delete result.suggestions.image_url;
          result.enrichment_status=(item.product_name||result.suggestions.product_name||item.retailer||result.suggestions.retailer)?'partial':'pending';
        }
  const report={...result.enrichment_report,fields:{...(item.enrichment_report?.fields||{}),...result.enrichment_report.fields}};
  const {data:updated,error:saveError}=await auth.database.from('content_items').update({...result.suggestions,enrichment_status:result.enrichment_status,enrichment_report:report,metadata_reviewed:false,image_rights_confirmed:!!(item.image_rights_confirmed||result.enrichment_report.fields.image_url?.imageUsagePermission===true),updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',auth.user.id).eq('updated_at',claimedAt).select('*').maybeSingle();
  if(saveError||!updated)return privateJson({error:'The item changed during lookup. Refresh before retrying.'},409);
  return privateJson({item:updated});
 }catch{return privateJson({error:'Source check failed. Your saved details are unchanged.'},503);}
}
