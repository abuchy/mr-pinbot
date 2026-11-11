import type { Metadata } from "next";
import { PageHeading } from "@/components/page-parts";
import { AnalyticsView } from "@/components/analytics-view";
export const metadata: Metadata = { title: "Analytics" };
export default function Analytics() {
  return <><PageHeading eyebrow="ROOM TO LEARN" title="Analytics" description="See what resonates across your Pinterest account."/><AnalyticsView/></>;
}
