import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { privateJson, publicDatabase, sameOrigin } from "@/lib/api-auth";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  try {
    const config = publicDatabase();
    if (!process.env.PINBOT_OWNER_EMAIL) return privateJson({ error: "Sign-in setup is not complete." }, 503);
    if (Number(request.headers.get("content-length")) > 2048) return privateJson({ error: "Request too large." }, 413);
    const { email } = await request.json();
    if (typeof email !== "string" || email.trim().toLowerCase() !== process.env.PINBOT_OWNER_EMAIL.toLowerCase()) return privateJson({ error: "This workspace is invite-only. Use your workspace email." }, 403);
    const database = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const origin = new URL(request.headers.get("origin")!);
    const isLocal = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
    const emailRedirectTo = isLocal ? new URL("/library", origin).href : "https://pinbot.annabuchy.com/library";
    const { error } = await database.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo } });
    if (error) return privateJson({ error: "Couldn’t send the sign-in link. Wait a minute and try again, or check your account setup." }, 429);
    return privateJson({ sent: true });
  } catch { return privateJson({ error: "Sign-in is unavailable. Please try again later." }, 503); }
}
