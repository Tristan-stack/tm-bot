import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Internal packages a given folder must never import. */
const restrictImports = (patterns, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: patterns, message }] }],
});

export default defineConfig(
  globalIgnores(["**/dist/", "**/coverage/", "packages/db/src/generated/"]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.ts", "packages/db/prisma.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Everything goes through the logger of @launchbot/shared/server, which masks secrets.
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },

  {
    files: ["apps/webapp/**"],
    languageOptions: { globals: globals.browser },
    rules: restrictImports(
      ["@launchbot/shared/server", "@launchbot/db", "@launchbot/solana"],
      "The Mini App runs in a browser: only @launchbot/shared (universal entry) and @launchbot/sim-engine are allowed.",
    ),
  },
  {
    files: ["packages/sim-engine/**"],
    rules: restrictImports(
      ["@launchbot/*", "node:*"],
      "sim-engine is pure TypeScript: no internal package, no Node API, no network.",
    ),
  },
  {
    files: ["packages/shared/**"],
    rules: restrictImports(["@launchbot/*"], "shared depends on no internal package."),
  },

  prettier,
);
