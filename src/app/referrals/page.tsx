import type { Metadata } from "next";
import { RealtorReferralPortal } from "@/components/realtor-portal";

export const metadata: Metadata = { title: "Your referrals · OrbitLOS", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ReferralsPage() {
  return <RealtorReferralPortal />;
}
