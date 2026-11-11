import "server-only";
import { connectionTable, pinterestBoard, pinterestConfig, refreshAccess } from "@/lib/pinterest";

export async function verifyPinBoard(owner: string, id: unknown) {
  if (typeof id !== "string" || !/^\d{1,32}$/.test(id)) throw new Error("Choose a Pinterest board.");
  const config = pinterestConfig();
  if (!config) throw new Error("Pinterest setup is pending.");
  const { data, error } = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", owner).maybeSingle();
  if (error || !data?.token_ciphertext || data.reconnect_required) throw new Error("Reconnect Pinterest to choose a board.");
  const board = await pinterestBoard(await refreshAccess(config, data), id);
  if (board.privacy !== "PUBLIC") throw new Error("Choose an available public Pinterest board.");
  return { pinterest_board_id: board.id, pinterest_board_name: board.name };
}
