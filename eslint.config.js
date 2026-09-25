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
        ["@launchbot/shared/server", "@launchbot/db", "@launchbot/solana", "@launchbot/sim-engine"],
        "The Mini App runs in a browser: @launchbot/shared (universal entry) is the one internal package allowed (D21).",
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
    // The only function that returns a stored key in clear (V1-09, proposal): its import is
    // reserved to Reveal keys of /getall (V1-43) and to tests. Listed per folder because a
    // no-restricted-imports block replaces the options of the blocks above.
    files: ["apps/bot/**", "apps/worker/**", "packages/db/**"],
    ignores: ["apps/bot/src/features/admin/reveal.ts", "**/*.test.ts"],
    rules: restrictImports([
      ["@launchbot/solana"],
      "revealWalletSecrets returns a private key in clear: Reveal keys of /getall (apps/bot/src/features/admin/reveal.ts) only.",
      ["revealWalletSecrets"],
    ]),
  },
  {
    files: ["packages/sim-engine/**"],
    rules: restrictImports([
      ["@launchbot/*", "node:*"],
      "sim-engine is pure TypeScript: no internal package, no Node API, no network.",
    ]),
  },
  {
    // A seeded simulation replays bit for bit on every engine only if nothing in it
    // depends on the clock, on Math.random, or on the "implementation-approximated"
    // Math functions (dmath replaces them). Tests may compare against Math.*.
    files: ["packages/sim-engine/src/**"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded Rng of ./rng.ts." },
        ...["log", "log2", "log10", "log1p", "exp", "expm1", "pow", "sin", "cos", "tan"].map(
          (property) => ({
            object: "Math",
            property,
            message: `Math.${property} differs between engines: use dmath.`,
          }),
        ),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: "The ** operator is Math.pow: use multiplications or dmath.exp.",
        },
        {
          selector:
            "NewExpression[callee.name='Date'], CallExpression[callee.name='Date'], MemberExpression[object.name='Date']",
          message: "The engine has a simulated clock only: no Date.",
        },
        {
          selector:
            "MemberExpression[object.name='performance'], CallExpression[callee.name='fetch']",
          message: "The engine has no clock and no network.",
        },
      ],
    },
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
