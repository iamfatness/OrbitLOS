import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { reconcileFv7Pipeline } = await import("../src/lib/mcr-fv7-pipeline.ts");

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) {
  console.error("Usage: node scripts/mcr-fv7-pipeline-workpaper.mjs <workpaper.json>");
  process.exitCode = 2;
} else {
  try {
    const result = reconcileFv7Pipeline(JSON.parse(await readFile(file, "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (!result.reconciled) process.exitCode = 1;
  } catch (error) {
    console.error(error.issues?.map(({ path, message }) => `${path.join(".")} · ${message}`).join("\n") ?? error.message);
    process.exitCode = 2;
  }
}
