import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  connectionTable, exchangeCode, oauthCookie, oauthPath, pinterestConfig,
  pinterestProfile, stateHash, tokenFields,
} from "@/lib/pinterest";

export async function GET(request: NextRequest) {
  const config = pinterestConfig();
  const finish = (status: string) => {
    const target = new URL("/queue", config?.callback ?? request.nextUrl);
    target.searchParams.set("pinterest", status);
    const response = NextResponse.redirect(target, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(oauthCookie, "", {
      httpOnly: true, secure: target.protocol === "https:", sameSite: "lax", path: oauthPath, maxAge: 0,
    });
    return response;
  };

  const state = request.nextUrl.searchParams.get("state");
  const cookie = request.cookies.get(oauthCookie)?.value;
  if (!config || !state || !cookie || !/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(cookie)
    || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return finish("expired");

  try {
    const { data, error } = await connectionTable(config)
      .update({ oauth_state_hash: null, oauth_expires_at: null })
      .eq("oauth_state_hash", stateHash(state)).gt("oauth_expires_at", new Date().toISOString())
      .select("owner_id,oauth_flow").maybeSingle();
    if (error) return finish("failed");
    if (!data) return finish("expired");
    if (request.nextUrl.searchParams.has("error")) return finish("cancelled");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) return finish("failed");

    const tokens = await exchangeCode(config, code);
    await pinterestProfile(tokens.access);
    const saved = await connectionTable(config)
      .update({ ...tokenFields(config, data.owner_id, tokens), oauth_flow: null })
      .eq("owner_id", data.owner_id).eq("oauth_flow", data.oauth_flow).select("owner_id").maybeSingle();
    return finish(saved.error || !saved.data ? "failed" : "connected");
  } catch {
    return finish("failed");
  }
}
