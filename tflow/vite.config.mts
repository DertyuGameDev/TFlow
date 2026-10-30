import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.TFLOW_BACKEND_URL ?? "http://127.0.0.1:8000";
export default defineConfig({
  base: process.env.VITE_ASSET_BASE ?? "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: Object.fromEntries(["/api", "/login", "/register", "/logout", "/static"].map(path => [path, {target: backend}])),
  },
  build: {outDir: "dist", emptyOutDir: true, sourcemap: false},
});
