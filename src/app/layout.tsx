import type { Metadata } from "next";
import { Domine, Space_Grotesk } from "next/font/google";
import { DashboardShell } from "@/components/dashboard-shell";
import "./globals.css";

const domine = Domine({ subsets: ["latin"], variable: "--font-domine", display: "swap" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Overview · Mr. Pinbot", template: "%s · Mr. Pinbot" },
  description: "A personal workspace for thoughtful Pinterest publishing.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${domine.variable} ${space.variable}`}><body><DashboardShell>{children}</DashboardShell></body></html>;
}
