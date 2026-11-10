import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { fictionalMismoNotice } from "../src/lib/mismo-artifact.ts";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { prepareUwmXmlUpload, uwmXmlUploadSuccessStatus } = await import("../src/lib/uwm-origination-blob.ts");

const [filename, digest] = process.argv.slice(2);
if (!filename || !/^[a-f0-9]{64}$/.test(digest ?? "")) {
  console.error("Usage: node scripts/check-uwm-origination-fixture.mjs <fictional-mismo.xml> <recorded-sha256>");
  process.exit(1);
}

try {
  const bytes = await readFile(filename);
  if (!bytes.subarray(0, 256).toString("utf8").includes(fictionalMismoNotice)) {
    throw new Error("Use XML exported from an OrbitLOS fictional application.");
  }
  const storageOrigin = "https://uwm-fixture.invalid";
  const request = prepareUwmXmlUpload({ signedUrl: `${storageOrigin}/fixture.xml?signature=fictional`, storageOrigin, bytes, digest });
  console.log(JSON.stringify({ artifactDigestMatched: true, bytes: bytes.byteLength, method: request.method,
    blobType: request.headers.get("x-ms-blob-type"), documentedUploadStatus: uwmXmlUploadSuccessStatus, outboundRequests: 0 }));
} catch (error) {
  console.error(error instanceof Error && "code" in error ? "Could not read the fictional XML fixture." :
    error instanceof Error ? error.message : "The fixture check failed.");
  process.exitCode = 1;
}
