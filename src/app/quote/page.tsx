import type { Metadata } from "next";
import { QuoteRequestForm } from "@/components/quote-request";

export const metadata: Metadata = { title: "Request a quote · OrbitLOS", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function QuotePage() {
  return <QuoteRequestForm />;
}
