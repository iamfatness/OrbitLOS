import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareClientAssets } from "./cloudflare-client-assets.mjs";

const sourceArg = process.argv[2];
if (!sourceArg) throw new Error("Pass the client output directory from the other verified build.");
const source = await realpath(resolve(sourceArg));
const destination = await realpath(fileURLToPath(new URL("../dist/client/", import.meta.url)));
if (source === destination) throw new Error("Use two distinct build directories.");

const pending = [];
for (const path of await cloudflareClientAssets(source)) {
  const bytes = await readFile(join(source, path));
  const target = join(destination, path);
  try {
    if (!bytes.equals(await readFile(target))) throw new Error(`Conflicting fingerprinted asset ${path}.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    pending.push({ target, bytes });
  }
}

for (const directory of new Set(pending.map(({ target }) => dirname(target)))) await mkdir(directory, { recursive: true });
for (const { target, bytes } of pending) await writeFile(target, bytes, { flag: "wx" });
console.log(`Retained ${pending.length} additional fingerprinted browser assets.`);
