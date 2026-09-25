import { defineConfig } from "vitest/config";

// One project per app/package. Integration tests are opt-in:
//   RUN_DB_TESTS=1      needs PostgreSQL (`pnpm db:up`), runs against launchbot_test
//   RUN_DEVNET_TESTS=1  needs network access to the Solana devnet RPC
const nodeProjects = [
  "packages/shared",
  "packages/sim-engine",
  "packages/sim-render",
  "packages/db",
  "packages/solana",
  "apps/api",
  "apps/bot",
  "apps/worker",
];

export default defineConfig({
  test: {
    projects: [
      ...nodeProjects.map((root) => ({
        test: {
          name: root.slice(root.indexOf("/") + 1),
          root,
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      })),
      // jsdom project, configured in apps/webapp/vite.config.ts
      "apps/webapp",
      // The checks of the whole repository (V1-46): texts outside en.ts.
      {
        test: { name: "scripts", root: "scripts", environment: "node", include: ["*.test.ts"] },
      },
    ],
  },
});
