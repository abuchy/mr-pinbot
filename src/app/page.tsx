import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { LibrarySummary } from "@/components/library-summary";
import { ArrowLink, PageHeading } from "@/components/page-parts";
export default function Overview() {
  return <>
    <PageHeading eyebrow="PINBOT HQ" title="Your publishing at a glance." action={<Link className="button primary" href="/library">Explore your library<Icon name="arrow" size={18}/></Link>}/>
    <section className="welcome-panel" aria-labelledby="welcome-title"><div><p className="eyebrow">MEET YOUR PUBLISHING PARTNER, MR. PINBOT</p><h2 id="welcome-title">Good finds deserve<br/>a little <span className="burgundy">follow-through.</span></h2><p>Drop your links and leave the Pin creation and publishing to Mr. Pinbot.</p><ArrowLink href="/queue">See your publishing queue</ArrowLink></div><div className="mascot-wrap"><span className="mascot-halo"/><Image className="hero-mascot" src="/pinbot.png" width={139} height={220} alt="Mr. Pinbot, your smiling robot publishing partner" priority/></div></section>
    <LibrarySummary/>
  </>;
}
