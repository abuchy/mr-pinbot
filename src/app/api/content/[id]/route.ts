import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { validateDetails } from "@/lib/content";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  try {
    const auth = await authenticatedDatabase(request);
    if (!auth) return privateJson({ error: "Please sign in to your workspace." }, 401);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return privateJson({ error: "Invalid item." }, 400);
    const body = await request.text();
    if (body.length > 15000) return privateJson({ error: "Product details are too long." }, 413);
    const input = JSON.parse(body);
    let details;
    try { details = validateDetails(input); } catch (error) { return privateJson({ error: error instanceof Error ? error.message : "Invalid details." }, 400); }
    if (typeof input.updated_at !== "string") return privateJson({ error: "Reload this item before saving." }, 400);
    const full=details.product_name&&details.website_url&&details.image_url&&details.product_description;
    const enrichment_status=full?'review_required':details.product_name?'partial':'pending';
    const { data, error } = await auth.database.from("content_items").update({ ...details, metadata_reviewed:true, enrichment_status, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", auth.user.id).eq("updated_at", input.updated_at).select("id").maybeSingle();
    if (error) return privateJson({ error: "Couldn’t save your changes. Please try again." }, 503);
    if (!data) return privateJson({ error: "This item changed in another tab. Refresh the library before editing again." }, 409);
    return privateJson({ saved: true });
  } catch { return privateJson({ error: "Couldn’t save your changes. Please try again." }, 503); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  try {
    const auth = await authenticatedDatabase(request);
    if (!auth) return privateJson({ error: "Please sign in to your workspace." }, 401);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return privateJson({ error: "Invalid item." }, 400);
    const body = await request.text();
    if (body.length > 1024) return privateJson({ error: "Invalid delete request." }, 400);
    const input = JSON.parse(body);
    if (typeof input.updated_at !== "string" || !Number.isFinite(Date.parse(input.updated_at))) return privateJson({ error: "Refresh the library before deleting this item." }, 400);
    const { data, error } = await auth.database.from("content_items").delete().eq("id", id).eq("owner_id", auth.user.id).eq("updated_at", input.updated_at).select("id").maybeSingle();
    if (error) return privateJson({ error: "Couldn’t delete this item. Please try again." }, 503);
    if (!data) return privateJson({ error: "This item changed or was already deleted. Refresh the library and try again." }, 409);
    return privateJson({ deleted: true });
  } catch { return privateJson({ error: "Couldn’t delete this item. Please try again." }, 503); }
}
