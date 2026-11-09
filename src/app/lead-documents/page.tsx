import type { Metadata } from "next";
import { LeadDocumentPortal } from "@/components/lead-document-portal";

export const metadata: Metadata = {
  title: "Lead document checklist · OrbitLOS Demo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LeadDocumentsPage() {
  return <LeadDocumentPortal />;
}
