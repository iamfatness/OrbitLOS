import { readdir } from "node:fs/promises";
import { relative, sep } from "node:path";

const publicAsset = /^(?:_orbit-assets\/[a-f0-9]{12}\/)?_next\/static\/(?:chunks\/[\w-]+\.js|css\/[\w-]+\.css)$/;

export async function cloudflareClientAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const assets = entries.filter((entry) => entry.isFile())
    .map((entry) => `${relative(directory, entry.parentPath).split(sep).join("/")}/${entry.name}`)
    .filter((path) => publicAsset.test(path));
  if (!assets.some((path) => path.endsWith(".js")) || !assets.some((path) => path.endsWith(".css"))) {
    throw new Error("No complete set of browser assets found. Run the production build first.");
  }
  return assets;
}
