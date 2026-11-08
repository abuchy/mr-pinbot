import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { LibrarySummary } from "@/components/library-summary";
import { ArrowLink, EmptyState, IntegrationNotice, PageHeading } from "@/components/page-parts";
export default function Overview() {
  return <>
    <PageHeading eyebrow="A FRESH START" title="A little more organized." description="Welcome, Anna. Let’s give your ideas a place to grow." action={<Link className="button primary" href="/library">Explore your library<Icon name="arrow" size={18}/></Link>}/>
    <section className="welcome-panel" aria-labelledby="welcome-title"><div><p className="eyebrow">MEET YOUR PUBLISHING PARTNER</p><h2 id="welcome-title">Good ideas deserve<br/>a little <span className="burgundy">follow-through.</span></h2><p>Collect your finds, make them your own, and give every Pin<br className="desktop-break"/> a thoughtful send-off. We’ll take it one step at a time.</p><ArrowLink href="/queue">See your publishing queue</ArrowLink></div><div className="mascot-wrap"><span className="mascot-halo"/><Image className="hero-mascot" src="/pinbot.png" width={139} height={220} alt="Mr. Pinbot, your smiling robot publishing partner" priority/><span className="mascot-caption">READY WHEN YOU ARE.</span></div></section>
    <LibrarySummary/>
    <div className="overview-columns"><section className="section-panel"><div className="section-header"><h2>Up next</h2><ArrowLink href="/queue">View queue</ArrowLink></div><EmptyState icon="queue" title="A little breathing room.">Your approved, scheduled Pins will appear here.<br/>For now, your queue is clear.</EmptyState><div className="panel-footnote"><span className="status-dot"/>Publishing is not connected yet</div></section><section className="getting-started"><p className="eyebrow">LAYING THE GROUNDWORK</p><h2>Your next chapter</h2><ol className="setup-list"><li><span className="step-number">01</span><div><strong>Make yourself at home</strong><p>Explore your new workspace.</p><span className="small-label">YOU ARE HERE</span></div></li><li><span className="step-number">02</span><div><strong>Connect your accounts</strong><p>Pinterest and ShopMy come next.</p></div></li><li><span className="step-number">03</span><div><strong>Prepare your first Pin</strong><p>Review it, approve it, then let it shine.</p></div></li></ol></section></div>
    <IntegrationNotice/>
  </>;
}
