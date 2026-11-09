import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson, sameOrigin } from "@/lib/api-auth";
import { pinterestConfig, pinterestDatabase } from "@/lib/pinterest";
import { defaultCadence, parseCadence } from "@/lib/publishing-cadence";

export async function GET(request: NextRequest) {
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to view cadence settings." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);
  const result = await pinterestDatabase(config).from("publishing_cadence")
    .select("settings").eq("owner_id", auth.user.id).maybeSingle();
  if (result.error) return privateJson({ error: "Cadence settings are unavailable." }, 503);
  return privateJson({ settings: parseCadence(result.data?.settings) ?? defaultCadence });
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request not allowed." }, 403);
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to change cadence settings." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ error: "Pinterest setup is pending." }, 503);
  const settings = parseCadence(await request.json().catch(() => null));
  if (!settings) return privateJson({ error: "Check the time zone and allow enough time in the posting window for your daily count and minimum gap." }, 400);
  const { error } = await pinterestDatabase(config).from("publishing_cadence").upsert({ owner_id: auth.user.id, settings });
  if (error) return privateJson({ error: "Could not save cadence settings." }, 503);
  return privateJson({ settings });
}
