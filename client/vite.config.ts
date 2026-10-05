import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Build number sent as X-App-Version and compared against the server's MIN_CLIENT_VERSION.
 * Defaults to the build time as YYYYMMDDHHmm (UTC), so newer builds are always larger.
 */
const appVersion = process.env.VITE_APP_VERSION || new Date().toISOString().replace(/\D/g, "").slice(0, 12);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** For a value placed inside an existing "..." string in JSON or JavaScript. */
const escapeQuoted = (s: string) => JSON.stringify(s).slice(1, -1);

/**
 * Fills in the build number and the league's app name: in index.html (dev and build), and in the public files Vite
 * copies as-is (sw.js and the manifest) after the build. A byte-different sw.js per build is what makes browsers
 * pick up a new version.
 */
function stampBuild(version: string, appName: string): Plugin {
  return {
    name: "stamp-build",
    transformIndexHtml: (html) => html.replaceAll("__APP_NAME_HTML__", escapeHtml(appName)),
    writeBundle(options) {
      for (const name of ["sw.js", "manifest.webmanifest"]) {
        const file = join(options.dir!, name);
        writeFileSync(
          file,
          readFileSync(file, "utf8").replaceAll("__APP_VERSION__", version).replaceAll("__APP_NAME__", escapeQuoted(appName)),
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // VITE_APP_NAME from client/.env or the environment (the GCP deploy passes it from APP_NAME in server.env).
  const appName = loadEnv(mode, process.cwd(), "VITE_").VITE_APP_NAME?.trim() || "Draft & Draft";
  return {
    plugins: [react(), tailwindcss(), stampBuild(appVersion, appName)],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_APP_NAME": JSON.stringify(appName),
    },
    server: {
      port: 5173,
      // Same-origin in dev too, matching the production proxy rewrite (SPEC Section 5).
      proxy: { "/api": "http://localhost:3001" },
    },
  };
});
