import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Build number sent as X-App-Version and compared against the server's MIN_CLIENT_VERSION.
 * Defaults to the build time as YYYYMMDDHHmm (UTC), so newer builds are always larger.
 */
const appVersion = process.env.VITE_APP_VERSION || new Date().toISOString().replace(/\D/g, "").slice(0, 12);

/** Stamps the build number into public/sw.js so every deploy is a byte-different worker the browser will pick up. */
function stampServiceWorker(version: string): Plugin {
  return {
    name: "stamp-service-worker",
    apply: "build",
    writeBundle(options) {
      const file = join(options.dir!, "sw.js");
      writeFileSync(file, readFileSync(file, "utf8").replaceAll("__APP_VERSION__", version));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker(appVersion)],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
    // Same-origin in dev too, matching the production proxy rewrite (SPEC Section 5).
    proxy: { "/api": "http://localhost:3001" },
  },
});
