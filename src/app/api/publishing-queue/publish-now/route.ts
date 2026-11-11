import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { safePublicUrl } from "@/lib/content";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { connectionTable, pinterestBoard, pinterestConfig, pinterestDatabase, pinterestProfile, refreshAccess } from "@/lib/pinterest";
import { publishClaimedPin } from "@/lib/publish-pin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to publish a Pin." }, 401);
  const input = await request.json().catch(() => null);
  if (typeof input?.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.id)
      || typeof input.version !== "string" || !Number.isFinite(Date.parse(input.version))) {
    return privateJson({ error: "Reload the queue and choose a Pin." }, 400);
  }
  if (process.env.PINBOT_PUBLISH_ENABLED !== "true") return privateJson({ error: "Publishing is paused. Enable publishing before using Publish now." }, 409);
  const config = pinterestConfig();
  if (!config || auth.user.id !== process.env.PINBOT_PUBLISH_OWNER_ID) return privateJson({ error: "Publishing is not configured for this workspace." }, 503);
  const database = pinterestDatabase(config);
  const itemResult = await auth.database.from("content_items").select("*").eq("owner_id", auth.user.id).eq("id", input.id).maybeSingle();
  if (itemResult.error) return privateJson({ error: "Could not load this Pin." }, 503);
  const item = itemResult.data;
  if (!item || item.updated_at !== input.version) return privateJson({ error: "This Pin changed. Refresh and review it again." }, 409);
  const destination = item.website_url || item.affiliate_url;
  if (!item.product_name.trim() || [...item.product_name].length > 100 || isBlockedMetadata(item.product_name)
      || !item.product_description.trim() || [...item.product_description].length > 500 || isBlockedMetadata(item.product_description)
      || !safePublicUrl(item.image_url) || !safePublicUrl(destination)) {
    return privateJson({ error: "Edit this Pin to add a title, description, image, and destination before publishing." }, 400);
  }
  const job = await database.from("pin_approvals").select("board_id,publish_status").eq("owner_id", auth.user.id).eq("content_id", item.id).maybeSingle();
  if (job.error) return privateJson({ error: "Could not check this Pin's publishing status." }, 503);
  if (job.data && !["queued", "failed"].includes(job.data.publish_status)) return privateJson({ error: "This Pin is already published, publishing, or awaiting verification." }, 409);
  const boardId = job.data?.board_id || item.pinterest_board_id;
  if (!boardId) return privateJson({ error: "Choose a Pinterest board in Edit this Pin first." }, 400);
  const trial = process.env.PINTEREST_ACCESS_TIER !== "standard";
  const sandboxToken = process.env.PINTEREST_SANDBOX_ACCESS_TOKEN?.trim();
  if (trial && (!sandboxToken || boardId !== process.env.PINTEREST_SANDBOX_BOARD_ID)) {
    return privateJson({ error: "Trial publishing requires the configured Pinterest Sandbox board. Choose it in Edit this Pin." }, 409);
  }
  try {
    const connection = await connectionTable(config).select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
      .eq("owner_id", auth.user.id).maybeSingle();
    if (connection.error || !connection.data?.token_ciphertext || connection.data.reconnect_required) return privateJson({ error: "Reconnect Pinterest before publishing." }, 409);
    const access = await refreshAccess(config, connection.data);
    const token = trial ? sandboxToken! : access;
    const [profile, board] = await Promise.all([pinterestProfile(token, trial), pinterestBoard(token, boardId, trial)]);
    if (board.privacy !== "PUBLIC" || (trial && profile.username !== (await pinterestProfile(access)).username)) {
      return privateJson({ error: "The saved Pinterest account or board is unavailable." }, 409);
    }
    const claim = await database.rpc("claim_pin_now", {
      p_owner: auth.user.id, p_content: item.id, p_version: item.updated_at,
      p_account: profile.username, p_board: board.id, p_board_name: board.name,
    }).maybeSingle<Record<string, string>>();
    if (claim.error) {
      console.warn("[pinbot:publish-now]", { operation: "claim_pin_now", code: claim.error.code });
      return privateJson({ error: "Could not start publishing. Refresh the queue and try again." }, 503);
    }
    if (!claim.data) return privateJson({ error: "This Pin changed or another Pin is publishing or awaiting verification. Refresh the queue before trying again." }, 409);
    return publishClaimedPin(database, auth.user.id, claim.data, async () => token, trial);
  } catch {
    return privateJson({ error: "Pinterest could not verify the saved account and board." }, 503);
  }
}
