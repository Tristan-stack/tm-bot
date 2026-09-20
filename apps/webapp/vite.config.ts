import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Telegram only opens a Mini App over HTTPS: hosts of the local tunnels.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
  },
  test: {
    name: "webapp",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
