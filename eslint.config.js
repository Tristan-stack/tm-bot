import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Imports a given folder must never use: one [patterns, message] pair per reason. A third
 * element restricts only these names of the modules, not the modules as a whole.
 */
const restrictImports = (...restrictions) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: restrictions.map(([group, message, importNames]) => ({
        group,
        message,
        ...(importNames ? { importNames } : {}),
      })),
    },
  ],
});

const SHARED_NO_INTERNAL = [["@launchbot/*"], "shared depends on no internal package."];

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
      [
        ["@launchbot/shared/server", "@launchbot/db", "@launchbot/solana"],
        "The Mini App runs in a browser: only @launchbot/shared (universal entry) and @launchbot/sim-engine are allowed.",
      ],
      [
        ["@launchbot/shared"],
        "`en` is one object: importing it ships every text of the bot in the Mini App. Use `enWebapp`.",
        ["en", "E"],
      ],
    ),
  },
  {
    files: ["apps/api/**"],
    rules: restrictImports([
      ["@launchbot/solana"],
      "The API never talks to Solana, which is why it starts without a devnet guard. A route that needs the chain must bring the guard with it.",
    ]),
  },
  {
    // The Vite configuration of the Mini App loads this file by a relative path, which only
    // works while it imports nothing.
    files: ["packages/shared/src/legal.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "ImportDeclaration", message: "legal.ts must not import anything." },
      ],
    },
  },
  {
    files: ["packages/sim-engine/**"],
    rules: restrictImports([
      ["@launchbot/*", "node:*"],
      "sim-engine is pure TypeScript: no internal package, no Node API, no network.",
    ]),
  },
  {
    files: ["packages/shared/**"],
    rules: restrictImports(SHARED_NO_INTERNAL),
  },
  // A later block replaces the options of a rule, it does not merge them: the restriction of
  // the block above is repeated.
  {
    files: ["packages/shared/src/**"],
    ignores: ["packages/shared/src/server/**"],
    rules: restrictImports(SHARED_NO_INTERNAL, [
      ["node:*", "**/server", "**/server/**"],
      "The universal entry of shared is bundled by the Mini App: Node code lives in src/server.",
    ]),
  },

  prettier,
);
