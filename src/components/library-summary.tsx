"use client";
import { useEffect, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";
import { Icon } from "./icons";
export function LibrarySummary() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const database = browserDatabase();
    if (!database) return;
    let active = true;
    let generation = 0;
    const { data } = database.auth.onAuthStateChange((_event, session) => {
      const current = ++generation;
      if (!session) { setCount(null); return; }
      void fetch('/api/content', { cache:'no-store', headers:{ Authorization:`Bearer ${session.access_token}` } })
        .then(response => response.ok ? response.json() : null)
        .then(result => { if (active && generation === current) setCount(result?.items?.length ?? null); })
        .catch(() => { if (active && generation === current) setCount(null); });
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const stats = [
    {label:'In your library',value:count === null ? '—' : count,note:count === null ? 'Sign in to view your saved finds' : 'Your saved product links',icon:'library' as const},
    {label:'Awaiting approval',value:'—',note:'Pin review is coming next',icon:'check' as const},
    {label:'Scheduled Pins',value:'—',note:'Scheduling is not connected',icon:'clock' as const},
    {label:'Published Pins',value:'—',note:'Publishing is not connected',icon:'pin' as const},
  ];
  return <section className="stats-grid" aria-label="Publishing summary">{stats.map(item => <div className="stat" key={item.label}><div className="stat-label">{item.label}<Icon name={item.icon} size={18}/></div><div className="stat-value">{item.value}</div><p>{item.note}</p></div>)}</section>;
}
