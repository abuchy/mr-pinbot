"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";

type Connection = {
  status: "connected" | "disconnected" | "setup_required" | "reconnect_required";
  tier: "trial" | "standard";
  profile?: { username: string; accountType?: string };
  boards?: { id: string; name: string }[];
  bookmark?: string | null;
};

const callbackMessages: Record<string, string> = {
  connected: "Pinterest authorization completed.",
  cancelled: "Pinterest authorization was cancelled.",
  expired: "That connection request expired. Start again from this page.",
  failed: "Pinterest could not finish connecting. Check the app configuration and try again.",
};

export function PinterestConnection() {
  const [connection, setConnection] = useState<Connection>();
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async (method = "GET") => {
    const session = (await browserDatabase()?.auth.getSession())?.data.session;
    if (!session) {
      setSignedOut(true);
      setConnection(undefined);
      return;
    }
    const response = await fetch("/api/pinterest?profileOnly=1", {
      method, headers: { Authorization: "Bearer " + session.access_token }, cache: "no-store",
    });
    if (response.status === 401) {
      setSignedOut(true);
      setConnection(undefined);
      return;
    }
    const data = await response.json() as Connection & { authorizeUrl?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "Pinterest is temporarily unavailable.");
    if (data.authorizeUrl) {
      window.location.assign(data.authorizeUrl);
      return;
    }
    if (method === "DELETE") setNotice("Pinterest disconnected from Mr. Pinbot.");
    setSignedOut(false);
    setConnection(data);
  }, []);

  const run = useCallback(async (method = "GET") => {
    setBusy(true);
    setError("");
    try {
      await request(method);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Pinterest is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("pinterest");
      if (outcome) {
        setNotice(Object.hasOwn(callbackMessages, outcome) ? callbackMessages[outcome] : "");
        url.searchParams.delete("pinterest");
        window.history.replaceState(null, "", url);
      }
      void run();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [run]);

  return <section className="section-panel" aria-labelledby="pinterest-connection-title">
    <div className="section-header">
      <h2 id="pinterest-connection-title">Pinterest Connection</h2>
      {connection && <span className="build-status">
        <span className="pinterest-status-dot" data-connected={connection.status === "connected"} aria-hidden="true"/>
        {connection.status === "connected" ? "Connected"
          : connection.status === "reconnect_required" ? "Reconnect required"
          : connection.status === "setup_required" ? "Setup required" : "Disconnected"}
      </span>}
    </div>
    <div className="pinterest-connection-body">
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <button className="inline-button" onClick={() => void run()}>Retry</button></p>}
    {signedOut ? <Link className="text-link" href="/library">Sign in to connect Pinterest</Link>
      : connection?.status === "connected" ? <div className="pinterest-account">
        <p><strong>@{connection.profile?.username}</strong><br/>Pinterest Business Account</p>
        <button className="button quiet" disabled={busy} onClick={() => {
          if (window.confirm("Disconnect Pinterest from Mr. Pinbot?")) void run("DELETE");
        }}>Disconnect</button>
      </div> : <button className="button primary" disabled={busy || connection?.status === "setup_required"} onClick={() => {
        if (connection?.tier !== "standard" && !window.confirm("Trial access uses the Pinterest Sandbox. Trial Pins are not published publicly. Continue connecting?")) return;
        void run("POST");
      }}>Connect Pinterest</button>}
    </div>
  </section>;
}
