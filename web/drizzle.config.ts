import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://configuration:missing@127.0.0.1:5432/bible_brain",
  },
  strict: true,
  verbose: true,
});
