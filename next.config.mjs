import { fileURLToPath } from "node:url";

const config = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  agentRules: false,
};

export default config;
