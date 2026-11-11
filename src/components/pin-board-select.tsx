"use client";

import { useEffect, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";

export function PinBoardSelect({ value, onChange, disabled = false, enabled = true, required = true }: {
  value: string; onChange: (id: string) => void; disabled?: boolean; enabled?: boolean; required?: boolean;
}) {
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const session = (await browserDatabase()?.auth.getSession())?.data.session;
        if (!session) throw new Error("Sign in to load your Pinterest boards.");
        let cursor: string | null = null;
        const seen = new Set<string>();
        const all: { id: string; name: string }[] = [];
        do {
          const response: Response = await fetch("/api/pinterest" + (cursor ? "?bookmark=" + encodeURIComponent(cursor) : ""), {
            headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
          });
          const result: { status?: string; error?: string; boards?: { id: string; name: string }[]; bookmark?: string | null } = await response.json();
          if (!response.ok || result.status !== "connected") throw new Error(result.error || "Connect Pinterest on the Publishing Queue page to load boards.");
          all.push(...(result.boards ?? []));
          const next: string | null = result.bookmark || null;
          if (next && seen.has(next)) throw new Error("Board loading was interrupted. Try again.");
          if (next) seen.add(next);
          cursor = next;
        } while (cursor && active);
        if (active) setBoards([...new Map(all.map(board => [board.id, board])).values()]);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load Pinterest boards.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [enabled, retry]);
  return <div>
    <label className="field-label">Pinterest Board
      <select className="pin-board-select" data-placeholder={!value} required={required} value={value} disabled={disabled || loading || !enabled}
        onChange={event => onChange(event.target.value)}>
        <option value="" disabled={!!value}>{loading ? "Loading boards…" : "Choose a board"}</option>
        {value && !boards.some(board => board.id === value) && <option value={value}>Saved board · {value}</option>}
        {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
      </select>
    </label>
    {error && <p className="validation-error" role="alert">{error} <button type="button" className="inline-button" disabled={disabled || loading} onClick={() => setRetry(previous => previous + 1)}>Reload boards</button></p>}
  </div>;
}
