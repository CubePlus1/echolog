import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/http-validation.ts"],
  outDir: "dist",
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
});
