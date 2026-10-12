import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/.well-known": "http://127.0.0.1:8787",
      "/oauth": "http://127.0.0.1:8787",
      "/media": "http://127.0.0.1:8787",
      "/openapi.json": "http://127.0.0.1:8787",
      "/agent.txt": "http://127.0.0.1:8787",
    },
  },
  build: { outDir: "dist" },
});
