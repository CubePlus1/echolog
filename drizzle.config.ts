import { defineConfig } from "drizzle-kit";
import { readFileSync } from "fs";
import { parse } from "yaml";

const config = parse(readFileSync("config.yaml", "utf-8")) as any;
const { user, password, host, port, name } = config.database;

export default defineConfig({
  schema: "./src/core/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: `postgres://${user}:${password}@${host}:${port}/${name}`,
  },
});
