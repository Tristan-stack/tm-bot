import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env by itself. Only DATABASE_URL matters here, so the full
// loadEnv() validation is not used: `prisma generate` must work on a fresh clone without .env.
config({ path: new URL("../../.env", import.meta.url), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
