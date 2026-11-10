import { fileURLToPath } from "node:url";

const assetRelease = process.env.ORBIT_ASSET_RELEASE;
if (assetRelease && !/^[a-f0-9]{12}$/.test(assetRelease)) {
  throw new Error("ORBIT_ASSET_RELEASE must be a 12-character lowercase hexadecimal ID.");
}

const config = {
  ...(assetRelease && { assetPrefix: `/_orbit-assets/${assetRelease}` }),
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  agentRules: false,
  ...(process.env.ORBIT_LOCAL_REHEARSAL === "1" && {
    distDir: ".next-orbit-rehearsal",
    typescript: { tsconfigPath: process.env.ORBIT_LOCAL_REHEARSAL_TSCONFIG },
  }),
};

export default config;
