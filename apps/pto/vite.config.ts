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
    // apex Worker), 5177 = store, 5178 = pto — all against the one API on 8787.
    //
    // Note what `vite dev` does NOT serve: the public page at `/` is a Pages
    // Function, so it exists under `wrangler pages dev` and in production, not
    // here. Same split the newsletter's archive and the store's storefront
    // have — see ROUTING.md.
    port: 5178,
  },
});
