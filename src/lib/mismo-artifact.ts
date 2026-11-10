import { createHash } from "node:crypto";

export const fictionalMismoNotice = "<!-- OrbitLOS pilot manual handoff. Fictional data. -->";

export function mismoArtifactDigest(contents: string | Uint8Array) {
  return createHash("sha256").update(contents).digest("hex");
}
