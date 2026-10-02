import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sd/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    // 5173 = directory, 5174 = calendar, 5175 = newsletter, 5176 = home (the
    // apex Worker), 5177 = store, 5178 = pto, 5179 = lost & found — all
    // against the one API on 8787.
    //
    // Unlike the PTO, the store and the newsletter, everything here is in the
    // bundle — the public browse page included — so `vite dev` serves the
    // whole site. There are no Pages Functions; see ROUTING.md.
    port: 5179,
  },
});
