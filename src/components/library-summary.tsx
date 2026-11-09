"use client";
import { useEffect, useState } from "react";
import { browserDatabase } from "@/lib/supabase-browser";
import { Icon } from "./icons";

type LibraryItem = { id: string; product_name: string; image_url: string | null };
type Approval = {
  content_id: string;
  publish_status: string;
  scheduled_at: string | null;
  automatic_at: string | null;
};

async function loadItems<T>(path: string, token: string): Promise<T[] | null> {
  try {
    const response = await fetch(path, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok ? (await response.json()).items : null;
  } catch {
    return null;
  }
}

const emptyCounts = { library: 0, awaiting: 0, scheduled: 0, published: 0 };

export function LibrarySummary() {
  const [counts, setCounts] = useState(emptyCounts);
  useEffect(() => {
    const database = browserDatabase();
    if (!database) return;
    let generation = 0;
    const { data } = database.auth.onAuthStateChange((_event, session) => {
      const current = ++generation;
      if (!session) {
        setCounts(emptyCounts);
        return;
      }

      void Promise.all([
        loadItems<LibraryItem>("/api/content", session.access_token),
        loadItems<Approval>("/api/publishing-queue", session.access_token),
      ]).then(([items, approvals]) => {
        if (generation !== current) return;
        const approvedIds = new Set(approvals?.map(pin => pin.content_id));
        setCounts({
          library: items?.length ?? 0,
          awaiting: items && approvals
            ? items.filter(item => item.product_name.trim() && item.image_url && !approvedIds.has(item.id)).length
            : 0,
          scheduled: approvals?.filter(pin => pin.publish_status === "queued" && (pin.scheduled_at ?? pin.automatic_at)).length ?? 0,
          published: approvals?.filter(pin => pin.publish_status === "published").length ?? 0,
        });
      });
    });
    return () => { generation++; data.subscription.unsubscribe(); };
  }, []);
  const stats = [
    {label:'In your library',value:counts.library,note:'Your saved product links',icon:'library' as const},
    {label:'Awaiting approval',value:counts.awaiting,note:'Pins ready for review',icon:'check' as const},
    {label:'Scheduled Pins',value:counts.scheduled,note:'Pins queued for publishing',icon:'clock' as const},
    {label:'Published Pins',value:counts.published,note:'Pins shared to Pinterest',icon:'pin' as const},
  ];
  return <section className="stats-grid" aria-label="Publishing summary">{stats.map(item => <div className="stat" key={item.label}><div className="stat-label">{item.label}<Icon name={item.icon} size={18}/></div><div className="stat-value">{item.value}</div><p>{item.note}</p></div>)}</section>;
}
