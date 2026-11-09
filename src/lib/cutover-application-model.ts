export type CutoverApplicationStatus = "Matched" | "Changed" | "Missing in draft" | "Added in draft" | "Not supplied";

export type CutoverApplicationComparison = {
  fingerprint: string;
  revision: number;
  rows: { key: string; label: string; source: string | null; draft: string | null; status: CutoverApplicationStatus }[];
  sourceExtraBorrowers: number | null;
  draftExtraBorrowers: number;
  missingExtraBorrowers: number;
};
