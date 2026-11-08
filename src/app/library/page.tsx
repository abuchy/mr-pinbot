import type { Metadata } from "next";
import { PageHeading, IntegrationNotice } from "@/components/page-parts";
import { LibraryView } from "@/components/library-view";
export const metadata: Metadata = { title: "Content Library" };
export default function Library() { return <><PageHeading eyebrow="A HOME FOR YOUR FINDS" title="Content Library" description="A place to collect, shape, and revisit your next great Pin."/><LibraryView/><IntegrationNotice/></>; }
