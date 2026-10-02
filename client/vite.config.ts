import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev too, matching the production proxy rewrite (SPEC Section 5).
    proxy: { "/api": "http://localhost:3001" },
  },
});
