import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
// A relative import, with its extension, of a file that imports nothing: Node cannot load a
// workspace package shipped as TypeScript source from a configuration file.
import { resolveTermsVersion } from "../../packages/shared/src/legal.ts";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../..");

/**
 * The root .env holds the server secrets (BOT_TOKEN, WALLET_ENCRYPTION_KEY…). Only these keys
 * are read from it, and only TERMS_VERSION and API_URL reach the bundle: never spread `env`.
 */
const ENV_KEYS = ["TERMS_VERSION", "API_URL", "API_PORT"];

export default defineConfig(({ mode }) => {
  // Tests get the defaults, not the .env of whoever runs them: the root vitest.config.ts loads
  // this file for every project, and a test must not depend on a developer's TERMS_VERSION.
  const env = mode === "test" ? {} : loadEnv(mode, WORKSPACE_ROOT, ENV_KEYS);

  return {
    plugins: [react()],
    define: {
      // Throws, and so fails the build, when the version has no publication date.
      __TERMS_VERSION__: JSON.stringify(resolveTermsVersion(env["TERMS_VERSION"])),
      __API_URL__: JSON.stringify(env["API_URL"] ?? ""),
    },
    server: {
      port: 5173,
      strictPort: true,
      // Telegram only opens a Mini App over HTTPS: hosts of the local tunnels.
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
      // One tunnel is enough: the Mini App and its API share the origin of the tunnel.
      // 3001 is the default of API_PORT in packages/shared/src/server/env.ts.
      proxy: { "/api": `http://127.0.0.1:${env["API_PORT"] || 3001}` },
    },
    test: {
      name: "webapp",
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
