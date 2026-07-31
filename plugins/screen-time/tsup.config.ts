import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  outDir: "dist",
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
});
