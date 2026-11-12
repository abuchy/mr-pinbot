import type { Metadata } from "next";
import { PageHeading } from "@/components/page-parts";
import { LibraryView } from "@/components/library-view";
export const metadata: Metadata = { title: "Content Library" };
export default function Library() { return <><PageHeading eyebrow="TOO GOOD NOT TO PIN" title="Content Library" description="Consider this your holding place for future Pinterest greatness."/><LibraryView/><p className="integration-notice library-privacy-notice">Your library is private. Importing a link never approves, schedules, or publishes a Pin.</p></>; }
