import { fileURLToPath } from "node:url";

const config = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  agentRules: false,
  ...(process.env.ORBIT_LOCAL_REHEARSAL === "1" && {
    distDir: ".next-orbit-rehearsal",
    typescript: { tsconfigPath: process.env.ORBIT_LOCAL_REHEARSAL_TSCONFIG },
  }),
};

export default config;
