import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceArg = process.argv[2];
if (!sourceArg) throw new Error("Pass the client output directory from the other verified build.");
const source = await realpath(resolve(sourceArg));
const destination = await realpath(fileURLToPath(new URL("../dist/client/", import.meta.url)));
if (source === destination) throw new Error("Use two distinct build directories.");

const pending = [];
for (const [folder, extension] of [["chunks", "js"], ["css", "css"]]) {
  const relative = join("_next", "static", folder);
  const entries = await readdir(join(source, relative), { withFileTypes: true });
  const namePattern = new RegExp(`^[A-Za-z0-9_-]+\\.${extension}$`);
  const assets = entries.filter((entry) => entry.isFile() && namePattern.test(entry.name));
  if (!assets.length) throw new Error(`The other build has no generated ${folder}.`);
  for (const { name } of assets) {
    const path = join(relative, name);
    const bytes = await readFile(join(source, path));
    const target = join(destination, path);
    try {
      if (!bytes.equals(await readFile(target))) throw new Error(`Conflicting fingerprinted asset ${path}.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      pending.push({ target, bytes });
    }
  }
}

for (const { target, bytes } of pending) await writeFile(target, bytes, { flag: "wx" });
console.log(`Retained ${pending.length} additional fingerprinted browser assets.`);
