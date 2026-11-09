import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { safePublicUrl } from "@/lib/content";
import { connectionTable, pinterestBoard, pinterestConfig, pinterestDatabase, PinterestError, pinterestProfile, refreshAccess } from "@/lib/pinterest";

const fields = "id,content_id,pinterest_account,board_id,board_name,title,description,image_url,destination_url,approved_at,scheduled_at,automatic_at,publish_status,published_at,pinterest_pin_id,publish_error";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to view the approval queue." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);
  const result = await pinterestDatabase(config).from("pin_approvals").select(fields)
    .eq("owner_id", auth.user.id).order("approved_at").order("id");
  if (result.error) return privateJson({ error: "The approval queue is unavailable." }, 503);
  return privateJson({ items: result.data });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to approve a Pin." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);

  const input = await request.json().catch(() => null);
  if (!input || typeof input.id !== "string" || !uuid.test(input.id)
      || typeof input.boardId !== "string" || !/^\d{1,32}$/.test(input.boardId)
      || typeof input.version !== "string" || typeof input.account !== "string") {
    return privateJson({ error: "Choose a library Pin and a Pinterest board." }, 400);
  }

  const { data: item, error } = await auth.database.from("content_items")
    .select("id,updated_at,product_name,product_description,image_url,website_url,affiliate_url")
    .eq("owner_id", auth.user.id).eq("id", input.id).maybeSingle();
  if (error) return privateJson({ error: "The library item is unavailable." }, 503);
  if (!item || item.updated_at !== input.version) {
    return privateJson({ error: "This Pin changed. Reload the library items and review it again." }, 409);
  }
  const destination = item.website_url || item.affiliate_url;
  if (!item.product_name.trim() || [...item.product_name].length > 100 ||
      [...item.product_description].length > 500 || !item.image_url || !safePublicUrl(item.image_url) ||
      !destination || !safePublicUrl(destination)) {
    return privateJson({ error: "Edit the library item first. Use a title up to 100 characters, a description up to 500, and public HTTPS image and destination URLs." }, 400);
  }

  try {
    const { data: row, error: connectionError } = await connectionTable(config)
      .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
      .eq("owner_id", auth.user.id).maybeSingle();
    if (connectionError) return privateJson({ error: "Pinterest connection storage is unavailable." }, 503);
    if (!row?.token_ciphertext) return privateJson({ error: "Connect Pinterest before approving a Pin." }, 409);
    const token = await refreshAccess(config, row);
    const [profile, board] = await Promise.all([pinterestProfile(token), pinterestBoard(token, input.boardId)]);
    if (profile.username !== input.account || board.id !== input.boardId || board.privacy !== "PUBLIC" || board.name !== input.boardName) {
      return privateJson({ error: "The Pinterest account or board changed. Refresh the queue and review again." }, 409);
    }
    const saved = await pinterestDatabase(config).from("pin_approvals").insert({
      owner_id: auth.user.id, content_id: item.id, pinterest_account: profile.username, board_id: board.id,
      board_name: board.name, title: item.product_name, description: item.product_description,
      image_url: item.image_url, destination_url: destination,
    }).select(fields).single();
    if (saved.error?.code === "23505") return privateJson({ error: "This Pin is already in the approval queue." }, 409);
    if (saved.error) return privateJson({ error: "Could not save the approval." }, 503);
    return privateJson({ item: saved.data }, 201);
  } catch (error) {
    return privateJson({
      error: error instanceof PinterestError ? error.message : "Pinterest is temporarily unavailable.",
    }, error instanceof PinterestError && error.status === 429 ? 429 : 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to manage the approval queue." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !uuid.test(id)) return privateJson({ error: "Choose an approved Pin." }, 400);
  const result = await pinterestDatabase(config).from("pin_approvals").delete()
    .eq("owner_id", auth.user.id).eq("id", id).in("publish_status", ["queued", "failed"]).select("id").maybeSingle();
  if (result.error) return privateJson({ error: "Could not remove the approval." }, 503);
  if (!result.data) return privateJson({ error: "This approval cannot be removed." }, 409);
  return privateJson({ removed: true });
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to schedule a Pin." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);

  const input = await request.json().catch(() => null);
  if (!input || typeof input.id !== "string" || !uuid.test(input.id)) {
    return privateJson({ error: "Choose an approved Pin." }, 400);
  }
  const time = typeof input.scheduledAt === "string" ? new Date(input.scheduledAt) : null;
  if (input.scheduledAt !== null && (!time || !Number.isFinite(time.getTime()) ||
      time.toISOString() !== input.scheduledAt || time.getTime() <= Date.now())) {
    return privateJson({ error: "Choose a publishing time in the future." }, 400);
  }

  const result = await pinterestDatabase(config).from("pin_approvals")
    .update({ scheduled_at: time?.toISOString() ?? null })
    .eq("owner_id", auth.user.id).eq("id", input.id).eq("publish_status", "queued").select(fields).maybeSingle();
  if (result.error) return privateJson({ error: "Could not save the publishing time." }, 503);
  if (!result.data) return privateJson({ error: "This approval is no longer in the queue." }, 404);
  return privateJson({ item: result.data });
}
