import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mr. Pinbot",
  description: "A personal workspace for thoughtful Pinterest publishing.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
