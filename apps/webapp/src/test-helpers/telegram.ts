import { vi } from "vitest";
import type { TelegramWebApp } from "../telegram";

/**
 * Puts a fake `window.Telegram.WebApp` in place, as telegram-web-app.js would. `changeTheme`
 * does what Telegram does when the user switches theme: update the scheme, then fire the event.
 */
export function insideTelegram(overrides: Partial<TelegramWebApp> = {}) {
  const listeners = new Set<() => void>();
  const webApp: TelegramWebApp = {
    initData: "query_id=AAE&user=%7B%7D&hash=abc",
    colorScheme: "light",
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    onEvent: (_event, handler) => void listeners.add(handler),
    offEvent: (_event, handler) => void listeners.delete(handler),
    ...overrides,
  };
  window.Telegram = { WebApp: webApp };

  return {
    webApp,
    listeners,
    changeTheme(colorScheme: TelegramWebApp["colorScheme"]) {
      webApp.colorScheme = colorScheme;
      for (const listener of listeners) listener();
    },
  };
}
