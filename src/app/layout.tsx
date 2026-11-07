import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitLOS · Mortgage Broker LOS and CRM",
  description: "One workspace for independent mortgage brokers to manage referrals, borrower applications, loan processing, closing, and client follow-up.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
