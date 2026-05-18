import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:19827",
    },
  },
  build: {
    outDir: "dist",
  },
});
