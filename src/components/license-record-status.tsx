import type { LicenseRecordCounts } from "@/lib/compliance-program-model";

export function LicenseRecordStatus({ counts }: { counts: LicenseRecordCounts }) {
  const { current, expired, review } = counts;
  if (!current && !expired && !review) return <>No records on file</>;
  return <>{current ? `${current} current` : "No current records"}
    {expired > 0 && ` · ${expired} expired`}{review > 0 && ` · ${review} to review`}</>;
}

