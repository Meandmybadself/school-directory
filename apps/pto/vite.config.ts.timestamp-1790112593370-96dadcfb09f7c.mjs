// vite.config.ts
import { defineConfig } from "file:///Users/jeffery/Sites/directory/node_modules/.pnpm/vite@6.4.3/node_modules/vite/dist/node/index.js";
import react from "file:///Users/jeffery/Sites/directory/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.3/node_modules/@vitejs/plugin-react/dist/index.js";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///Users/jeffery/Sites/directory/apps/pto/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sd/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    // 5173 = directory, 5174 = calendar, 5175 = newsletter, 5176 = home (the
    // apex Worker), 5177 = store, 5178 = pto — all against the one API on 8787.
    //
    // Note what `vite dev` does NOT serve: the public page at `/` is a Pages
    // Function, so it exists under `wrangler pages dev` and in production, not
    // here. Same split the newsletter's archive and the store's storefront
    // have — see ROUTING.md.
    port: 5178
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvamVmZmVyeS9TaXRlcy9kaXJlY3RvcnkvYXBwcy9wdG9cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9qZWZmZXJ5L1NpdGVzL2RpcmVjdG9yeS9hcHBzL3B0by92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvamVmZmVyeS9TaXRlcy9kaXJlY3RvcnkvYXBwcy9wdG8vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAc2Qvc2hhcmVkXCI6IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4uLy4uL3BhY2thZ2VzL3NoYXJlZC9zcmMvaW5kZXgudHNcIiwgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgLy8gNTE3MyA9IGRpcmVjdG9yeSwgNTE3NCA9IGNhbGVuZGFyLCA1MTc1ID0gbmV3c2xldHRlciwgNTE3NiA9IGhvbWUgKHRoZVxuICAgIC8vIGFwZXggV29ya2VyKSwgNTE3NyA9IHN0b3JlLCA1MTc4ID0gcHRvIFx1MjAxNCBhbGwgYWdhaW5zdCB0aGUgb25lIEFQSSBvbiA4Nzg3LlxuICAgIC8vXG4gICAgLy8gTm90ZSB3aGF0IGB2aXRlIGRldmAgZG9lcyBOT1Qgc2VydmU6IHRoZSBwdWJsaWMgcGFnZSBhdCBgL2AgaXMgYSBQYWdlc1xuICAgIC8vIEZ1bmN0aW9uLCBzbyBpdCBleGlzdHMgdW5kZXIgYHdyYW5nbGVyIHBhZ2VzIGRldmAgYW5kIGluIHByb2R1Y3Rpb24sIG5vdFxuICAgIC8vIGhlcmUuIFNhbWUgc3BsaXQgdGhlIG5ld3NsZXR0ZXIncyBhcmNoaXZlIGFuZCB0aGUgc3RvcmUncyBzdG9yZWZyb250XG4gICAgLy8gaGF2ZSBcdTIwMTQgc2VlIFJPVVRJTkcubWQuXG4gICAgcG9ydDogNTE3OCxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1UyxTQUFTLG9CQUFvQjtBQUNwVSxPQUFPLFdBQVc7QUFDbEIsU0FBUyxxQkFBcUI7QUFGd0osSUFBTSwyQ0FBMkM7QUFJdk8sSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLGNBQWMsY0FBYyxJQUFJLElBQUksc0NBQXNDLHdDQUFlLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBUU4sTUFBTTtBQUFBLEVBQ1I7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
