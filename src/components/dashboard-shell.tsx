"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";
const navigation: { href: string; label: string; icon: IconName; number: string }[] = [
  { href: "/", label: "Overview", icon: "overview", number: "01" },
  { href: "/library", label: "Content Library", icon: "library", number: "02" },
  { href: "/queue", label: "Publishing Queue", icon: "queue", number: "03" },
  { href: "/analytics", label: "Analytics", icon: "analytics", number: "04" },
];
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/capture") return children;
  const section = navigation.find(item => item.href === pathname)?.label ?? "Workspace";
  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Mr. Pinbot home"><Image src="/pinbot.png" width={31} height={49} alt="" priority/><span>Mr. Pinbot<span className="brand-caption">YOUR PERSONAL PIN PUSHER.</span></span></Link>
      <div className="nav-caption">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={`nav-link ${pathname === item.href ? "active" : ""}`}><Icon name={item.icon}/><span>{item.label}</span><span className="nav-number">{item.number}</span></Link>)}</nav>
      <div className="sidebar-bottom"><p>Good taste. Great automation.</p><div className="sidebar-note">Spend less time on the mindless busywork.</div><a className="portfolio-link" href="https://annabuchy.com" target="_blank" rel="noreferrer">Anna Buchy <span aria-hidden="true">↗</span></a></div>
    </aside>
    <div className="workspace"><header className="topbar"><div><span className="muted">Workspace</span><span className="slash">/</span>{section}</div></header><main id="main-content" tabIndex={-1}>{children}</main><footer className="workspace-footer"><span>Mr. Pinbot · Your personal pin pusher</span></footer></div>
  </>;
}
