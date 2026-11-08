export type IconName = "overview" | "library" | "queue" | "analytics" | "arrow" | "pin" | "check" | "clock" | "search";
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    library: <><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 1v6m8-6v6M8 11h8m-8 5h5"/></>,
    queue: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 5h2m4 0h2"/></>,
    analytics: <><path d="M4 3v18h17M9 16v-4m5 4V8m5 8V4"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    pin: <><path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Zm4 12v7"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
