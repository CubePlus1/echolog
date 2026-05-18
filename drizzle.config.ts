import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/core/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: "postgres://clawlog:clawlog@localhost:5436/clawlog",
  },
});
