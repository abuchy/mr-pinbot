import type { Metadata } from "next";
import { PageHeading } from "@/components/page-parts";
import { PinApprovalQueue } from "@/components/pin-approval-queue";
import { PinterestConnection } from "@/components/pinterest-connection";

export const metadata: Metadata = { title: "Publishing Queue" };

export default function Queue() {
  return <>
    <PageHeading eyebrow="ONE PIN AT A TIME" title="Publishing Queue" description="A thoughtful rhythm for the content you’re ready to share."/>
    <PinApprovalQueue/>
    <PinterestConnection/>
  </>;
}
