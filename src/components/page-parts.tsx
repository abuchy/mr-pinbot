import Link from "next/link";
import { Icon, type IconName } from "./icons";
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}
export function ArrowLink({ href, children }: { href: string; children: React.ReactNode }) { return <Link href={href} className="text-link">{children}<Icon name="arrow" size={17}/></Link>; }
export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{children}</p></div>; }
export function IntegrationNotice() { return <p className="integration-notice"><Icon name="pin" size={16}/>This is your dashboard shell. Account connections and publishing will be added in the next stages.</p>; }
