import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
  resolve: {
    alias: [
      { find: "@/lib/workspace-service", replacement: fileURLToPath(new URL("./src/lib/hosted-workspace-service.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
});
