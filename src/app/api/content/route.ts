import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { previewImport } from "@/lib/content";
import { enrichFromAuthorizedSources } from "@/lib/enrichment";
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticatedDatabase(request);
    if (!auth) return privateJson({ error: "Please sign in to your workspace." }, 401);
    const { data, error } = await auth.database.from("content_items").select("*").eq("owner_id", auth.user.id).order("created_at", { ascending: false });
    if (error) return privateJson({ error: "Couldn’t load your library. Please try again." }, 503);
    return privateJson({ items: data });
  } catch { return privateJson({ error: "Cloud storage is not configured yet." }, 503); }
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  try {
    const auth = await authenticatedDatabase(request);
    if (!auth) return privateJson({ error: "Please sign in to your workspace." }, 401);
    const body = await request.text();
    if (body.length > 60000) return privateJson({ error: "Paste up to 100 links at a time." }, 413);
    let preview;
    try { preview = previewImport(JSON.parse(body).text); } catch { return privateJson({ error: "Paste up to 100 valid ShopMy affiliate links." }, 400); }
    if (preview.invalid.length || !preview.links.length) return privateJson({ error: "Remove invalid links before importing." }, 400);
    // Ignore duplicates at the database constraint: concurrent imports cannot create two rows.
    const rows = await Promise.all(preview.links.map(async link => {
      const enrichment = await enrichFromAuthorizedSources(link);
      return { ...link, owner_id: auth.user.id, source: "pasted_link", enrichment_status: enrichment ? "enriched" : "manual_required", ...(enrichment?.fields ?? {}), provenance: enrichment ? { provider: enrichment.provider, authorizationReference: enrichment.authorizationReference } : {} };
    }));
    const { data, error } = await auth.database.from("content_items").upsert(rows, { onConflict: "owner_id,source_key", ignoreDuplicates: true }).select("id");
    if (error) return privateJson({ error: "Your links weren’t saved. Please try again; duplicates will be skipped safely." }, 503);
    const added = data?.length ?? 0;
    return privateJson({ added, duplicates: preview.duplicates + preview.links.length - added, message: "No approved enrichment source is connected. Add product details when you’re ready." });
  } catch { return privateJson({ error: "Import is unavailable. Your pasted links have not been cleared." }, 503); }
}
