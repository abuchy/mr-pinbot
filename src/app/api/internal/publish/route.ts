import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { privateJson } from "@/lib/api-auth";
import {
  connectionTable, createPinterestPin, pinterestBoard, pinterestConfig, pinterestDatabase,
  PinterestError, pinterestProfile, refreshAccess,
} from "@/lib/pinterest";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.PINBOT_PUBLISH_WORKER_SECRET;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!secret || !timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash("Bearer " + secret))) {
    return privateJson({ error: "Unauthorized." }, 401);
  }
  if (process.env.PINBOT_PUBLISH_ENABLED !== "true") return privateJson({ status: "paused" });

  const config = pinterestConfig();
  const owner = process.env.PINBOT_PUBLISH_OWNER_ID;
  if (!config || !owner) return privateJson({ error: "Publishing is not configured." }, 503);
  const database = pinterestDatabase(config);
  const { data: connection, error } = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", owner).maybeSingle();
  if (error) return privateJson({ error: "Connection storage unavailable." }, 503);
  if (!connection?.token_ciphertext || connection.reconnect_required) return privateJson({ status: "disconnected" });

  const { data: pin, error: claimError } = await database.rpc("claim_due_pin", { p_owner: owner }).maybeSingle<Record<string, string>>();
  if (claimError) return privateJson({ error: "Could not claim a due Pin." }, 503);
  if (!pin) return privateJson({ status: "idle" });

  const finish = async (status: string, fields: Record<string, string | null>) => {
    const result = await database.from("pin_approvals").update({ ...fields, publish_status: status })
      .eq("owner_id", owner).eq("id", pin.id).eq("publish_status", "publishing").select("id").maybeSingle();
    if (result.error || !result.data) return privateJson({ error: "Publishing outcome could not be saved." }, 503);
    return privateJson({ status });
  };

  let sent = false;
  let pinterestId: string;
  try {
    const token = await refreshAccess(config, connection);
    const [profile, board] = await Promise.all([pinterestProfile(token), pinterestBoard(token, pin.board_id)]);
    if (profile.username !== pin.pinterest_account || board.id !== pin.board_id || board.privacy !== "PUBLIC") {
      return await finish("failed", { publish_error: "The approved Pinterest account or board is no longer available." });
    }
    sent = true;
    pinterestId = await createPinterestPin(token, {
      board_id: pin.board_id, title: pin.title, description: pin.description,
      image_url: pin.image_url, destination_url: pin.destination_url,
    });
  } catch (error) {
    const rejected = error instanceof PinterestError && [400, 401, 403, 404, 422, 429].includes(error.status);
    const uncertain = sent && !rejected;
    return finish(uncertain ? "needs_verification" : "failed", {
      publish_error: uncertain ? "Check Pinterest for this Pin before taking further action."
        : error instanceof PinterestError ? error.message : "Publishing stopped before sending the Pin.",
    });
  }
  return finish("published", { pinterest_pin_id: pinterestId, published_at: new Date().toISOString(), publish_error: null });
}
