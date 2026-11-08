"use client";
import { createClient } from "@supabase/supabase-js";
let client: ReturnType<typeof createClient> | null = null;
export function browserDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}
