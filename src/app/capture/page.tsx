import type { Metadata } from "next";
import { CaptureForm } from "./capture-form";

export const metadata: Metadata = { title: "Save a new find · Mr. Pinbot", robots: { index: false } };

export default function CapturePage() {
  return <CaptureForm/>;
}
