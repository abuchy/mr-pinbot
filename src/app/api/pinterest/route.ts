import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import {
  connectionTable, oauthCookie, oauthLifetime, oauthPath, pinterestBoards, pinterestConfig,
  PinterestError, pinterestProfile, refreshAccess, scopes, stateHash,
} from "@/lib/pinterest";

const tier = () => process.env.PINTEREST_ACCESS_TIER === "standard" ? "standard" : "trial";

export async function GET(request: NextRequest) {
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to Mr. Pinbot first." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ status: "setup_required", tier: tier() });

  if (request.nextUrl.searchParams.get("environment") === "sandbox") {
    const token = process.env.PINTEREST_SANDBOX_ACCESS_TOKEN?.trim();
    if (!token || tier() !== "trial") return privateJson({ error: "Pinterest Sandbox is not configured." }, 503);
    const cursor = request.nextUrl.searchParams.get("bookmark") || undefined;
    if (cursor && cursor.length > 2048) return privateJson({ error: "Invalid board cursor." }, 400);
    try {
      const profile = await pinterestProfile(token, true);
      const boards = await pinterestBoards(token, cursor, true);
      return privateJson({ profile, ...boards });
    } catch (error) {
      const detail = error instanceof PinterestError && error.upstream
        ? ` (HTTP ${error.upstream.httpStatus}${error.upstream.code === undefined ? "" : `, Pinterest code ${error.upstream.code}`})`
        : "";
      return privateJson({ error: "Sandbox boards could not be loaded." + detail }, 502);
    }
  }

  const { data: row, error } = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", auth.user.id).maybeSingle();
  if (error) return privateJson({ error: "Pinterest connection storage is unavailable." }, 503);
  if (!row?.token_ciphertext) return privateJson({ status: "disconnected", tier: tier() });

  const bookmark = request.nextUrl.searchParams.get("bookmark") || undefined;
  if (bookmark && bookmark.length > 2048) return privateJson({ error: "Invalid board cursor." }, 400);
  const load = async (token: string) => {
    const [profile, boards] = await Promise.all([
      bookmark ? null : pinterestProfile(token),
      pinterestBoards(token, bookmark),
    ]);
    return privateJson({ status: "connected", tier: tier(), profile, ...boards });
  };

  try {
    const token = await refreshAccess(config, row);
    try {
      return await load(token);
    } catch (error) {
      if (!(error instanceof PinterestError) || error.status !== 401) throw error;
      const current = await connectionTable(config)
        .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
        .eq("owner_id", auth.user.id).single();
      if (current.error) throw new PinterestError("Reconnect Pinterest to continue.", 401);
      return await load(await refreshAccess(config, current.data, current.data.revision === row.revision));
    }
  } catch (error) {
    if (error instanceof PinterestError && error.status === 401) {
      return privateJson({ status: "reconnect_required", tier: tier() });
    }
    return privateJson({
      error: error instanceof PinterestError ? error.message : "Pinterest is temporarily unavailable.",
    }, error instanceof PinterestError && error.status === 429 ? 429 : 503);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to Mr. Pinbot first." }, 401);
  const config = pinterestConfig();
  if (!config || config.callback.host !== request.headers.get("host")) {
    return privateJson({ error: "Pinterest OAuth is not configured for this domain." }, 503);
  }

  const state = randomBytes(32).toString("base64url");
  const { error } = await connectionTable(config).upsert({
    owner_id: auth.user.id,
    oauth_flow: randomUUID(),
    oauth_state_hash: stateHash(state),
    oauth_expires_at: new Date(Date.now() + oauthLifetime * 1000).toISOString(),
  }, { defaultToNull: false });
  if (error) return privateJson({ error: "Pinterest connection storage is unavailable." }, 503);

  const authorize = new URL("https://www.pinterest.com/oauth/");
  authorize.search = new URLSearchParams({
    client_id: config.appId, redirect_uri: config.redirectUri, response_type: "code",
    scope: scopes.join(","), state,
  }).toString();
  const response = privateJson({ authorizeUrl: authorize.href });
  response.cookies.set(oauthCookie, state, {
    httpOnly: true, secure: config.callback.protocol === "https:", sameSite: "lax", path: oauthPath, maxAge: oauthLifetime,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to Mr. Pinbot first." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest is not configured." }, 503);
  const { error } = await connectionTable(config).delete().eq("owner_id", auth.user.id);
  if (error) return privateJson({ error: "Could not disconnect Pinterest. Try again." }, 503);
  return privateJson({ status: "disconnected", tier: tier() });
}
