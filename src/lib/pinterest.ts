import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const oauthCookie = "pinbot_pinterest_oauth";
export const oauthPath = "/api/pinterest/oauth/callback";
export const oauthLifetime = 600;
export const scopes = ["user_accounts:read", "boards:read", "pins:read", "pins:write"];

type Connection = {
  owner_id: string;
  revision: string;
  token_ciphertext: string | null;
  access_expires_at: string | null;
  reconnect_required: boolean;
};

type Tokens = { access: string; refresh: string; expires: string };

export class PinterestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstream?: { operation: string; httpStatus: number; code?: number },
  ) {
    super(message);
  }
}

export function pinterestConfig() {
  const { PINTEREST_APP_ID: appId, PINTEREST_APP_SECRET: appSecret,
    PINTEREST_REDIRECT_URI: redirectUri, PINTEREST_TOKEN_ENCRYPTION_KEY: encodedKey,
    SUPABASE_SECRET_KEY: databaseKey, NEXT_PUBLIC_SUPABASE_URL: databaseUrl } = process.env;
  const encryptionKey = Buffer.from(encodedKey ?? "", "base64");
  if (!appId || !appSecret || !redirectUri || !databaseKey || !databaseUrl || encryptionKey.length !== 32) return null;
  try {
    const callback = new URL(redirectUri);
    if (callback.pathname !== oauthPath || callback.search || callback.hash || callback.username || callback.password) return null;
    if (callback.protocol !== "https:" && !(callback.protocol === "http:" && callback.hostname === "localhost")) return null;
    return { appId, appSecret, redirectUri, callback, encryptionKey, databaseKey, databaseUrl };
  } catch {
    return null;
  }
}

type Config = NonNullable<ReturnType<typeof pinterestConfig>>;

export function pinterestDatabase(config: Config) {
  return createClient(config.databaseUrl, config.databaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function connectionTable(config: Config) {
  return pinterestDatabase(config).from("pinterest_connections");
}

export function pinterestBoard(token: string, boardId: string) {
  if (!/^\d{1,32}$/.test(boardId)) throw new PinterestError("Choose a valid board.", 400);
  return pinterestRequest<{ id: string; name: string; privacy: string }>("boards/" + boardId, {
    headers: { Authorization: "Bearer " + token },
  });
}

export function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function encrypt(config: Config, owner: string, tokens: Tokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

function decrypt(config: Config, owner: string, ciphertext: string): Tokens {
  const bytes = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}

async function pinterestRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, "https://api.pinterest.com/v5/"), {
    ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const message = response.status === 429 ? "Pinterest’s rate limit was reached. Try again later."
      : response.status === 403 ? "Pinterest declined access. Check your app access and account permissions."
      : "Pinterest could not complete the request.";
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "code" in body && typeof body.code === "number"
      && Number.isSafeInteger(body.code) ? body.code : undefined;
    const operation = (init.method ?? "GET") + " /" + path.split(/[/?]/).slice(0, path.startsWith("oauth/") ? 2 : 1).join("/");
    throw new PinterestError(message, response.status, { operation, httpStatus: response.status, code });
  }
  return response.json();
}

async function tokenRequest(config: Config, fields: Record<string, string>, existingRefresh?: string): Promise<Tokens> {
  const result = await pinterestRequest<{ access_token: string; refresh_token?: string; expires_in: number }>("oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(config.appId + ":" + config.appSecret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
  const refresh = result.refresh_token || existingRefresh;
  if (!result.access_token || !refresh || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
    throw new Error("Pinterest returned incomplete credentials.");
  }
  return { access: result.access_token, refresh, expires: new Date(Date.now() + result.expires_in * 1000).toISOString() };
}

export function exchangeCode(config: Config, code: string) {
  return tokenRequest(config, {
    grant_type: "authorization_code", code, redirect_uri: config.redirectUri, continuous_refresh: "true",
  });
}

export function tokenFields(config: Config, owner: string, tokens: Tokens) {
  return {
    token_ciphertext: encrypt(config, owner, tokens),
    access_expires_at: tokens.expires,
    refresh_locked_until: null,
    reconnect_required: false,
    revision: randomUUID(),
  };
}

export async function refreshAccess(config: Config, row: Connection, force = false) {
  if (!row.token_ciphertext || row.reconnect_required) throw new PinterestError("Reconnect Pinterest to continue.", 401);
  const tokens = decrypt(config, row.owner_id, row.token_ciphertext);
  if (!force && Date.parse(row.access_expires_at ?? "") > Date.now() + 60_000) return tokens.access;
  const lease = new Date(Date.now() + 30_000).toISOString();
  const { data, error } = await connectionTable(config).update({ refresh_locked_until: lease })
    .eq("owner_id", row.owner_id).eq("revision", row.revision)
    .or("refresh_locked_until.is.null,refresh_locked_until.lt." + new Date().toISOString()).select("owner_id").maybeSingle();
  if (error || !data) throw new PinterestError("Pinterest is updating its connection. Try again shortly.", 503);
  const release = (fields: Record<string, unknown>) => connectionTable(config).update(fields)
    .eq("owner_id", row.owner_id).eq("revision", row.revision).eq("refresh_locked_until", lease);
  try {
    const refreshed = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: tokens.refresh }, tokens.refresh);
    const saved = await release(tokenFields(config, row.owner_id, refreshed)).select("owner_id").maybeSingle();
    if (saved.error || !saved.data) throw new Error("Could not save the refreshed connection.");
    return refreshed.access;
  } catch (error) {
    const rejected = error instanceof PinterestError && [400, 401].includes(error.status);
    await release({ refresh_locked_until: null, ...(rejected ? { reconnect_required: true } : {}) });
    if (rejected) throw new PinterestError("Reconnect Pinterest to continue.", 401, error.upstream);
    throw error;
  }
}

export async function pinterestProfile(token: string) {
  const profile = await pinterestRequest<{ username: string; account_type?: string }>("user_account", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!profile.username) throw new Error("Pinterest did not return an account.");
  return { username: profile.username, accountType: profile.account_type };
}

export async function pinterestBoards(token: string, bookmark?: string) {
  const query = new URLSearchParams({ page_size: "100" });
  if (bookmark) query.set("bookmark", bookmark);
  const result = await pinterestRequest<{ items: { id: string; name: string; privacy?: string }[]; bookmark?: string }>("boards?" + query, {
    headers: { Authorization: "Bearer " + token },
  });
  return {
    boards: result.items.filter(board => !board.privacy || board.privacy === "PUBLIC")
      .map(({ id, name }) => ({ id, name })),
    bookmark: result.bookmark || null,
  };
}

export async function createPinterestPin(token: string, pin: {
  board_id: string; title: string; description: string; image_url: string; destination_url: string;
}) {
  const result = await pinterestRequest<{ id: string }>("pins", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      board_id: pin.board_id, title: pin.title, description: pin.description, link: pin.destination_url,
      media_source: { source_type: "image_url", url: pin.image_url },
    }),
  });
  if (typeof result.id !== "string" || !/^\d+$/.test(result.id)) throw new Error("Pinterest returned no Pin ID.");
  return result.id;
}
