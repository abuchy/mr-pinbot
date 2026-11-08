import { NextRequest } from 'next/server';
import { authenticatedDatabase, privateJson, sameOrigin } from '@/lib/api-auth';
import { previewImport, validateDetails } from '@/lib/content';
import { enrichFromAuthorizedSources } from '@/lib/enrichment';
export const maxDuration=30;
export async function GET(request: NextRequest) {
  try {
    const auth=await authenticatedDatabase(request);
    if(!auth) return privateJson({error:'Please sign in to your workspace.'},401);
    const {data,error}=await auth.database.from('content_items').select('*').eq('owner_id',auth.user.id).order('created_at',{ascending:false});
    return error?privateJson({error:'Couldn’t load your library.'},503):privateJson({items:data});
  } catch { return privateJson({error:'Cloud storage is unavailable.'},503); }
}
export async function POST(request: NextRequest) {
  if(!sameOrigin(request)) return privateJson({error:'Request not allowed.'},403);
  try {
    const auth=await authenticatedDatabase(request);
    if(!auth) return privateJson({error:'Please sign in.'},401);
    const body=await request.text();
    if(body.length>70000) return privateJson({error:'Paste up to 100 links at a time.'},413);
    const input=JSON.parse(body);
    let parsed;
    try { parsed=previewImport(input.text); } catch { return privateJson({error:'Check your pasted links.'},400); }
    if(parsed.invalid.length||!parsed.links.length) return privateJson({error:'Remove invalid entries before saving.'},400);
    let details: ReturnType<typeof validateDetails> | undefined;
    if(input.details) {
      if(parsed.links.length!==1) return privateJson({error:'Review one product at a time.'},400);
      try { details=validateDetails(input.details); } catch(error){return privateJson({error:error instanceof Error?error.message:'Check product details.'},400);}
    }
    // Save first, before any optional network operation. Duplicates never overwrite edits.
    const {data,error}=await auth.database.from('content_items').upsert(parsed.links.map(link=>({...link,owner_id:auth.user.id,source:'pasted_link',enrichment_status:'pending',...(details||{}),metadata_reviewed:input.reviewed===true})),{onConflict:'owner_id,source_key',ignoreDuplicates:true}).select('*');
    if(error) return privateJson({error:'Links could not be saved. Your pasted text is preserved.'},503);
    let checked=0;
    // A bounded, user-triggered lookup, not an unattended crawler. Remaining items stay pending.
    for(const item of (data||[]).slice(0,1)) {
      try {
        const result=await enrichFromAuthorizedSources(item,item);
        const merged={...item,...result.suggestions};
        const full=merged.product_name&&merged.retailer&&merged.product_url&&merged.image_url;
        const status=full&&input.reviewed===true?'manual':result.enrichment_status;
        const update={...result.suggestions,enrichment_status:status,enrichment_report:result.enrichment_report,metadata_reviewed:input.reviewed===true,image_rights_confirmed:!!(item.image_rights_confirmed||result.suggestions.image_url),updated_at:new Date().toISOString()};
        const saved=await auth.database.from('content_items').update(update).eq('id',item.id).eq('owner_id',auth.user.id).eq('updated_at',item.updated_at);
        if(!saved.error) checked++;
      } catch { /* The saved pending link survives source/configuration failures. */ }
    }
    return privateJson({added:data?.length||0,duplicates:parsed.duplicates+parsed.links.length-(data?.length||0),message:checked?'Available enrichment checked. Review suggestions; missing metadata stays pending.':'Links saved with metadata pending. Use Check for details to retry.'});
  }catch{return privateJson({error:'Import could not finish. Retry safely; saved links will be deduplicated.'},503);}
}
