import type { Metadata } from "next";
import { BorrowerApplicationForm } from "@/components/borrower-application";

export const metadata: Metadata = {
  title: "Borrower workspace · OrbitLOS Demo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ApplyPage() {
  return <BorrowerApplicationForm />;
}
