import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { isBlockedMetadata } from "@/lib/enrichment/blocked";
import { safePublicUrl } from "@/lib/content";
import { connectionTable, pinterestBoard, pinterestConfig, pinterestDatabase, pinterestProfile, refreshAccess } from "@/lib/pinterest";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to manage your Pins." }, 401);
  const input = await request.json().catch(() => null);
  if (!Array.isArray(input?.ids) || !input.ids.length || input.ids.length > 1000 ||
      !input.ids.every((id: unknown) => typeof id === "string" && uuid.test(id)) ||
      !["schedule", "unschedule", "retry"].includes(input.action)) {
    return privateJson({ error: "Choose valid Pins." }, 400);
  }
  const ids = [...new Set<string>(input.ids)];
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);
  const database = pinterestDatabase(config);

  if (input.action === "unschedule") {
    const result = await database.from("pin_approvals").delete().eq("owner_id", auth.user.id)
      .in("content_id", ids).in("publish_status", ["queued", "failed"]).select("id");
    if (result.error) return privateJson({ error: "Could not unschedule the selected Pins." }, 503);
    return privateJson({ message: `${result.data.length} unscheduled · ${ids.length - result.data.length} skipped.` });
  }

  if (input.action === "retry") {
    const result = await database.rpc("retry_failed_library_pins", { p_owner: auth.user.id, p_ids: ids });
    if (result.error) return privateJson({ error: "Could not retry these Pins." }, 503);
    return privateJson({ message: `${result.data} queued for retry · ${ids.length - result.data} skipped.` });
  }

  const trial = process.env.PINTEREST_ACCESS_TIER !== "standard";
  const sandboxToken = process.env.PINTEREST_SANDBOX_ACCESS_TOKEN?.trim();
  if (trial && !sandboxToken) return privateJson({ error: "Connect a Sandbox board before scheduling Trial Pins." }, 400);
  const { data: connection, error } = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", auth.user.id).maybeSingle();
  if (error) return privateJson({ error: "Pinterest connection unavailable." }, 503);
  if (!connection?.token_ciphertext || connection.reconnect_required) {
    return privateJson({ error: "Connect Pinterest before scheduling Pins." }, 409);
  }

  try {
    const access = await refreshAccess(config, connection);
    const token = trial ? sandboxToken! : access;
    const profile = await pinterestProfile(token, trial);
    if (trial && profile.username !== (await pinterestProfile(access)).username) {
      return privateJson({ error: "The Sandbox token belongs to a different Pinterest account." }, 409);
    }
    const items = await auth.database.from("content_items")
      .select("id,updated_at,product_name,product_description,image_url,website_url,affiliate_url,pinterest_board_id")
      .eq("owner_id", auth.user.id).in("id", ids);
    if (items.error) return privateJson({ error: "Could not read the selected Pins." }, 503);
    const groups = new Map<string, Record<string, string>>();
    const verifiedBoards = new Map<string, Awaited<ReturnType<typeof pinterestBoard>>>();
    // Verify every board before inserting any jobs. Each group retains optimistic row versions.
    for (const item of items.data) {
      const id = item.pinterest_board_id || (trial ? process.env.PINTEREST_SANDBOX_BOARD_ID : input.boardId);
      if (typeof id !== "string" || !/^\d{1,32}$/.test(id)) return privateJson({ error: "Choose a board in Edit this Pin for each selected Pin." }, 400);
      if (!verifiedBoards.has(id)) {
        const board = await pinterestBoard(token, id, trial);
        if (board.privacy !== "PUBLIC") return privateJson({ error: "A selected board is unavailable. Edit the Pin to choose another board." }, 409);
        verifiedBoards.set(id, board);
      }
      if (!groups.has(id)) groups.set(id, {});
    }
    const skipped: string[] = [];
    for (const item of items.data) {
      if (!item.product_name.trim() || isBlockedMetadata(item.product_name) || isBlockedMetadata(item.product_description) || [...item.product_name].length > 100 ||
          [...item.product_description].length > 500 || !item.image_url || !safePublicUrl(item.image_url) ||
          !safePublicUrl(item.website_url || item.affiliate_url)) {
        skipped.push(`${item.product_name || "Untitled Pin"}: add a title (up to 100 characters), public HTTPS image and destination, and keep the description within 500 characters.`);
      } else {
        const id = item.pinterest_board_id || (trial ? process.env.PINTEREST_SANDBOX_BOARD_ID : input.boardId);
        groups.get(id)![item.id] = item.updated_at;
      }
    }
    let scheduled = 0;
    for (const [id, versions] of groups) {
      if (!Object.keys(versions).length) continue;
      const board = verifiedBoards.get(id)!;
      const result = await database.rpc("schedule_library_pins", {
        p_owner: auth.user.id, p_versions: versions, p_account: profile.username,
        p_board: board.id, p_board_name: board.name,
      });
      if (result.error) return privateJson({ error: `${scheduled} scheduled. Scheduling was interrupted. Refresh and retry the remaining Drafts.` }, 503);
      scheduled += result.data;
    }
    return privateJson({ message: `${scheduled} scheduled · ${ids.length - scheduled} skipped. ${skipped.join(" ")}`.trim() });
  } catch {
    return privateJson({ error: "Pinterest could not verify the account and board." }, 503);
  }
}
