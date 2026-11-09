import type { Metadata } from "next";
import { PageHeading } from "@/components/page-parts";
import { LibraryView } from "@/components/library-view";
import { PinterestConnection } from "@/components/pinterest-connection";

export const metadata: Metadata = { title: "Publishing Queue" };

export default function Queue() {
  return <>
    <PageHeading eyebrow="IN THE PIPELINE" title="Publishing Queue" description="Automated publishing, strategically paced."/>
    <div className="queue-workspace"><LibraryView queue/></div>
    <PinterestConnection/>
  </>;
}
