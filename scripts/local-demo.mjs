import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, ".orbit");
mkdirSync(directory, { recursive: true });
const rehearsal = mkdtempSync(join(directory, "rehearsal-"));
const database = join(rehearsal, "orbit.sqlite");
const tsconfig = join(rehearsal, "tsconfig.json");
writeFileSync(tsconfig, JSON.stringify({ extends: "../../tsconfig.json" }, null, 2));
const port = "3410";
const workspace = `http://127.0.0.1:${port}/workspace`;

console.log(`OrbitLOS local demo
Campaign walkthrough  ${workspace}?guide=campaign
Referral walkthrough  ${workspace}?guide=1
Fictional workspace   ${database}
`);

const next = join(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    ORBIT_LOCAL_REHEARSAL: "1",
    ORBIT_LOCAL_REHEARSAL_TSCONFIG: relative(root, tsconfig).split(sep).join("/"),
    ORBIT_DB_PATH: database,
    ORBIT_PRICING_MODE: "mock",
    GOOGLE_PLACES_API_KEY: "",
  },
});

server.on("error", (error) => {
  console.error(`Could not start OrbitLOS: ${error.message}`);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
