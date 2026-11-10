import { mismoArtifactDigest } from "./mismo-artifact";

export const uwmXmlUploadSuccessStatus = 201;

// The expected storage origin must come from approved environment configuration, not the upload URL.
export function prepareUwmXmlUpload({ signedUrl, storageOrigin, bytes, digest }: {
  signedUrl: string; storageOrigin: string; bytes: Uint8Array; digest: string;
}) {
  const url = URL.parse(signedUrl);
  const signatures = url?.searchParams.getAll("sig") ?? [];
  if (!url || url.protocol !== "https:" || url.origin !== storageOrigin || url.username || url.password ||
    url.hash || url.pathname === "/" || signatures.length !== 1 || !signatures[0]?.trim()) {
    throw new Error("The UWM upload target is outside the approved storage origin or missing its signature.");
  }
  if (!bytes.byteLength || mismoArtifactDigest(bytes) !== digest) {
    throw new Error("The upload bytes do not match the reviewed MISMO export digest.");
  }
  return new Request(url, { method: "PUT", redirect: "manual", headers: { "x-ms-blob-type": "BlockBlob" }, body: new Uint8Array(bytes) });
}
