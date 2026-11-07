import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitLOS · Mortgage Broker Workspace",
  description: "Manage borrowers, applications, loan pricing, and lender updates in one mortgage broker workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
