import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { SessionBar } from "./session-bar";

export const metadata: Metadata = {
  title: "Incident Lab",
  description: "Practice a real on-call shift: answer the page, find the bad release, and bring checkout back.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><SessionBar />{children}</body>
    </html>
  );
}
