import type { Metadata } from "next";
import { CoBorrowerApplicationForm } from "@/components/co-borrower-application";

export const metadata: Metadata = {
  title: "Co-borrower workspace · OrbitLOS Demo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CoBorrowerPage() {
  return <CoBorrowerApplicationForm />;
}
