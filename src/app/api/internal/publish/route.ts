import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { privateJson } from "@/lib/api-auth";
import {
  connectionTable, pinterestConfig, pinterestDatabase, refreshAccess,
} from "@/lib/pinterest";

import { publishClaimedPin } from "@/lib/publish-pin";

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
  const trial = process.env.PINTEREST_ACCESS_TIER !== "standard";
  const target = process.env.PINBOT_TRIAL_PIN_ID;
  const sandboxToken = trial ? process.env.PINTEREST_SANDBOX_ACCESS_TOKEN?.trim() : undefined;
  const sandboxBoard = trial ? process.env.PINTEREST_SANDBOX_BOARD_ID : undefined;
  if (trial && (!sandboxToken || !sandboxBoard || !/^\d{1,32}$/.test(sandboxBoard))) {
    return privateJson({ status: "sandbox_setup_required" });
  }
  if (trial && !target) return privateJson({ status: "trial_target_required" });
  if (!config || !owner) return privateJson({ error: "Publishing is not configured." }, 503);
  const database = pinterestDatabase(config);
  const { data: connection, error } = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", owner).maybeSingle();
  if (error) return privateJson({ error: "Connection storage unavailable." }, 503);
  if (!connection?.token_ciphertext || connection.reconnect_required) return privateJson({ status: "disconnected" });

  if (trial) {
    const approved = await database.from("pin_approvals").select("id")
      .eq("owner_id", owner).eq("id", target!).maybeSingle();
    if (approved.error) return privateJson({ error: "Trial target unavailable." }, 503);
    if (!approved.data) return privateJson({ status: "trial_target_required" });
  }
  const claim = trial ? database.rpc("claim_trial_pin", { p_pin: target })
    : database.rpc("claim_due_pin", { p_owner: owner });
  const { data: pin, error: claimError } = await claim.maybeSingle<Record<string, string>>();
  if (claimError) return privateJson({ error: "Could not claim a due Pin." }, 503);
  if (!pin) return privateJson({ status: "idle" });

  return publishClaimedPin(database, owner, pin,
    async () => sandboxToken ?? await refreshAccess(config, connection), trial, sandboxBoard);
}
