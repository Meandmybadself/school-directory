// vite.config.ts
import { defineConfig } from "file:///Users/jeffery/Sites/directory/node_modules/.pnpm/vite@6.4.3/node_modules/vite/dist/node/index.js";
import react from "file:///Users/jeffery/Sites/directory/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.3/node_modules/@vitejs/plugin-react/dist/index.js";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///Users/jeffery/Sites/directory/apps/newsletter/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sd/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    // 5173 = directory, 5174 = calendar, 5175 = newsletter — all three run side
    // by side in dev against the one API on 8787.
    port: 5175
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvamVmZmVyeS9TaXRlcy9kaXJlY3RvcnkvYXBwcy9uZXdzbGV0dGVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvamVmZmVyeS9TaXRlcy9kaXJlY3RvcnkvYXBwcy9uZXdzbGV0dGVyL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9qZWZmZXJ5L1NpdGVzL2RpcmVjdG9yeS9hcHBzL25ld3NsZXR0ZXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAc2Qvc2hhcmVkXCI6IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4uLy4uL3BhY2thZ2VzL3NoYXJlZC9zcmMvaW5kZXgudHNcIiwgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgLy8gNTE3MyA9IGRpcmVjdG9yeSwgNTE3NCA9IGNhbGVuZGFyLCA1MTc1ID0gbmV3c2xldHRlciBcdTIwMTQgYWxsIHRocmVlIHJ1biBzaWRlXG4gICAgLy8gYnkgc2lkZSBpbiBkZXYgYWdhaW5zdCB0aGUgb25lIEFQSSBvbiA4Nzg3LlxuICAgIHBvcnQ6IDUxNzUsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFQsU0FBUyxvQkFBb0I7QUFDelYsT0FBTyxXQUFXO0FBQ2xCLFNBQVMscUJBQXFCO0FBRnNLLElBQU0sMkNBQTJDO0FBSXJQLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxjQUFjLGNBQWMsSUFBSSxJQUFJLHNDQUFzQyx3Q0FBZSxDQUFDO0FBQUEsSUFDNUY7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUE7QUFBQTtBQUFBLElBR04sTUFBTTtBQUFBLEVBQ1I7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
