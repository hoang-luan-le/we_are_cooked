import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SessionBar } from "./session-bar";

export const metadata: Metadata = {
  title: "Incident Lab",
  description: "Practice handling an on-call software incident.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><SessionBar />{children}</body>
    </html>
  );
}
