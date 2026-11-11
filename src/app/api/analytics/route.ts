import { NextRequest } from "next/server";
import { authenticatedDatabase, privateJson } from "@/lib/api-auth";
import { connectionTable, pinterestAccountAnalytics, pinterestAccountPins, pinterestConfig, PinterestError, pinterestProfile, refreshAccess } from "@/lib/pinterest";
import { analyticsRange, metricValues, normalizeAnalyticsPin } from "@/lib/pinterest-analytics";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await authenticatedDatabase(request);
  if (!auth) return privateJson({ error: "Sign in to see your Pinterest analytics." }, 401);
  const config = pinterestConfig();
  if (!config) return privateJson({ status: "setup_required", error: "Pinterest setup is incomplete." }, 503);
  const mode = request.nextUrl.searchParams.get("mode") || "summary";
  const days = Number(request.nextUrl.searchParams.get("days") || 30);
  const bookmark = request.nextUrl.searchParams.get("bookmark") || undefined;
  if (!["summary", "pins"].includes(mode) || ![7, 30, 90].includes(days) || (bookmark && bookmark.length > 2048)) {
    return privateJson({ error: "Choose a valid analytics range." }, 400);
  }
  const connection = await connectionTable(config)
    .select("owner_id,revision,token_ciphertext,access_expires_at,reconnect_required")
    .eq("owner_id", auth.user.id).maybeSingle();
  if (connection.error) return privateJson({ error: "Pinterest connection storage is unavailable." }, 503);
  if (!connection.data?.token_ciphertext || connection.data.reconnect_required) {
    return privateJson({ status: "reconnect_required", error: "Connect or reconnect Pinterest on the Publishing Queue page." }, 409);
  }
  try {
    const token = await refreshAccess(config, connection.data);
    if (mode === "pins") {
      let warning: string | null = null;
      let pins;
      try { pins = await pinterestAccountPins(token, bookmark); }
      catch (failure) {
        if (!(failure instanceof PinterestError) || ![400, 403].includes(failure.status)) throw failure;
        pins = await pinterestAccountPins(token, bookmark, false);
        warning = "Pinterest returned your Pins without performance metrics. Your app or account may need additional analytics access.";
      }
      return privateJson({
        items: pins.items.map(normalizeAnalyticsPin), bookmark: pins.bookmark || null, warning,
        checkedAt: new Date().toISOString(),
      });
    }
    const range = analyticsRange(days);
    const [profile, report] = await Promise.all([
      pinterestProfile(token), pinterestAccountAnalytics(token, range.start, range.end),
    ]);
    const all = report.all;
    return privateJson({
      status: "connected", profile, range, metrics: metricValues(all?.summary_metrics),
      daily: (all?.daily_metrics ?? []).map(day => ({ date: day.date, status: day.data_status || null, metrics: metricValues(day.metrics) })),
      checkedAt: new Date().toISOString(),
    });
  } catch (failure) {
    const detail = failure instanceof PinterestError && failure.upstream
      ? ` (Pinterest HTTP ${failure.upstream.httpStatus}${failure.upstream.code === undefined ? "" : `, code ${failure.upstream.code}`})` : "";
    const denied = failure instanceof PinterestError && failure.status === 403;
    console.warn("[pinbot:analytics]", { mode, status: failure instanceof PinterestError ? failure.status : undefined });
    return privateJson({
      error: (denied ? "Pinterest denied access to this account's analytics. Check app analytics access and reconnect Pinterest if its permissions changed."
        : failure instanceof Error ? failure.message : "Pinterest analytics is temporarily unavailable.") + detail,
    }, failure instanceof PinterestError && failure.status === 429 ? 429 : 503);
  }
}
