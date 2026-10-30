import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sd/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    // 5173 = directory, 5174 = calendar, 5175 = newsletter, 5176 = home,
    // 5177 = store, 5178 = pto, 5179 = lost & found, 5180 = bingo — all
    // against the one API on 8787.
    port: 5180,
  },
});
