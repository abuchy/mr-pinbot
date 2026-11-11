import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { privateJson } from "@/lib/api-auth";
import { createPinterestPin, pinterestBoard, pinterestProfile, PinterestError } from "@/lib/pinterest";

export async function publishClaimedPin(
  database: SupabaseClient, owner: string, pin: Record<string, string>,
  getToken: () => Promise<string>, trial: boolean, boardOverride?: string,
) {
  const finish = async (status: string, fields: Record<string, string | null>) => {
    const result = await database.from("pin_approvals").update({ ...fields, publish_status: status })
      .eq("owner_id", owner).eq("id", pin.id).eq("publish_status", "publishing").select("id").maybeSingle();
    if (result.error || !result.data) return privateJson({ error: "Publishing outcome could not be saved." }, 503);
    return privateJson({ status, ...(fields.publish_error ? { error: fields.publish_error } : {}) });
  };

  let sent = false;
  let pinterestId: string;
  try {
    const token = await getToken();
    const boardId = boardOverride ?? pin.board_id;
    const [profile, board] = await Promise.all([pinterestProfile(token, trial), pinterestBoard(token, boardId, trial)]);
    if (profile.username !== pin.pinterest_account || board.id !== boardId || board.privacy !== "PUBLIC") {
      return await finish("failed", { publish_error: "The approved Pinterest account or board is no longer available." });
    }
    sent = true;
    pinterestId = await createPinterestPin(token, {
      board_id: boardId, title: pin.title, description: pin.description,
      image_url: pin.image_url, destination_url: pin.destination_url,
    }, trial);
  } catch (error) {
    const rejected = error instanceof PinterestError && [400, 401, 403, 404, 422, 429].includes(error.status);
    const uncertain = sent && !rejected;
    const message = uncertain ? "Check Pinterest for this Pin before taking further action."
      : error instanceof PinterestError ? error.message : "Publishing stopped before sending the Pin.";
    const upstream = error instanceof PinterestError ? error.upstream : undefined;
    const diagnostics = upstream
      ? ` (${upstream.operation}, HTTP ${upstream.httpStatus}${upstream.code === undefined ? "" : `, Pinterest code ${upstream.code}`})`
      : "";
    return finish(uncertain ? "needs_verification" : "failed", { publish_error: message + diagnostics });
  }
  return finish("published", { pinterest_pin_id: pinterestId, published_at: new Date().toISOString(), publish_error: null });
}
