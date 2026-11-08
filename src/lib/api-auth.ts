import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
export function publicDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Cloud storage is not configured yet.");
  return { url, key };
}
export async function authenticatedDatabase(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { url, key } = publicDatabase();
  const database = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await database.auth.getUser(token);
  if (error || !data.user || !process.env.PINBOT_OWNER_EMAIL || data.user.email?.toLowerCase() !== process.env.PINBOT_OWNER_EMAIL.toLowerCase()) return null;
  const { data: member } = await database.from("workspace_members").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return member ? { database, user: data.user } : null;
}
export function privateJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" } });
}
export function sameOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
    return origin.host === request.headers.get("host") && (origin.protocol === "https:" || (local && origin.protocol === "http:"));
  } catch { return false; }
}
