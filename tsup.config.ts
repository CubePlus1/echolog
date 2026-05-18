import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/server/app.ts"],
    outDir: "dist/server",
    format: "esm",
    sourcemap: true,
    clean: true,
  },
  {
    entry: ["src/cli/index.ts"],
    outDir: "dist/cli",
    format: "esm",
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/mcp/server.ts"],
    outDir: "dist/mcp",
    format: "esm",
    sourcemap: true,
  },
]);
