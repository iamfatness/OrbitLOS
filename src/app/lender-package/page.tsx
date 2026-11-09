import type { Metadata } from "next";
import { LenderPackage } from "@/components/lender-package";

export const metadata: Metadata = {
  title: "Lender package · OrbitLOS Demo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LenderPackagePage() {
  return <LenderPackage />;
}
