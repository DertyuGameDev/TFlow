import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

function version() {
  for (const candidate of [process.env.CI_COMMIT_SHA, process.env.GITHUB_SHA, process.env.VERCEL_GIT_COMMIT_SHA])
    if (candidate && /^[a-f0-9]{40}$/.test(candidate)) return candidate;
  try { return execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8", stdio:["ignore","pipe","ignore"]}).trim(); }
  catch { return "development"; }
}
const buildId = version();

const backend = process.env.TFLOW_BACKEND_URL ?? "http://127.0.0.1:8000";
export default defineConfig({
  base: process.env.VITE_ASSET_BASE ?? "/",
  define: { __TFLOW_BUILD_ID__: JSON.stringify(buildId) },
  // Only the app entry participates; local QA HTML files are not app pages.
  optimizeDeps: { entries: ["index.html"] },
  plugins: [react(), {name:"tflow-release", generateBundle() {
    this.emitFile({type:"asset", fileName:"version.json", source:JSON.stringify({id:buildId})});
  }}],
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: Object.fromEntries(["/api", "/login", "/register", "/logout", "/static"].map(path => [path, {target: backend}])),
  },
  build: {outDir: "dist", emptyOutDir: true, sourcemap: false},
});
