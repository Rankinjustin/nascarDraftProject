import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "..", "..", "client", "dist");

/**
 * Serves the built client from the same origin as the API when client/dist exists (the single-server deploy in
 * deploy/gcp). Same origin is what SPEC Section 5 needs for login on iPhones. In development Vite serves the
 * client instead and this is a no-op.
 *
 * Caching follows SPEC Section 11: index.html and the service worker are never cached, so a deploy is picked up
 * on the next launch; hashed assets are cached forever.
 */
export function serveClient(app: Express): void {
  if (!existsSync(join(DIST, "index.html"))) return;

  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, path) {
        if (path.includes(join("dist", "assets"))) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (path.includes(join("dist", "icons"))) {
          res.setHeader("Cache-Control", "public, max-age=86400");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // Client-side routes (/draft/:id, /admin, ...) all load the app shell.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(DIST, "index.html"));
  });
}
