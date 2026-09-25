import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  // Read .env from the repo root. Only VITE_* variables reach the browser.
  envDir: "..",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // `vercel dev` serves /api on port 3000; `npm run dev` proxies to it.
    proxy: { "/api": "http://localhost:3000" },
  },
});
