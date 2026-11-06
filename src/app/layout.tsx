import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit · Mortgage CRM",
  description: "A workspace for mortgage brokers to manage borrowers, loans and lender updates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
