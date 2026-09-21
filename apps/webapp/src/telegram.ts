import { useSyncExternalStore } from "react";

/** The part of `window.Telegram.WebApp` the Mini App uses (telegram-web-app.js). */
export type TelegramWebApp = {
  /** Raw signed string, sent to the API as is. `initDataUnsafe` is never used for auth. */
  initData: string;
  colorScheme: "light" | "dark";
  ready: () => void;
  expand: () => void;
  close: () => void;
  onEvent: (event: "themeChanged", handler: () => void) => void;
  offEvent: (event: "themeChanged", handler: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** `undefined` in a plain browser: the pages still render, only the API calls are refused. */
export const getWebApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

/** Called once at startup: tells Telegram the app is ready and takes the full height. */
export function initTelegramWebApp(): void {
  const webApp = getWebApp();
  webApp?.ready();
  webApp?.expand();
}

function onThemeChanged(notify: () => void): () => void {
  const webApp = getWebApp();
  webApp?.onEvent("themeChanged", notify);
  return () => webApp?.offEvent("themeChanged", notify);
}

const currentColorScheme = () => getWebApp()?.colorScheme ?? "light";

/**
 * The pages follow the theme through the CSS variables Telegram sets (`--tg-theme-*`), with no
 * script. `colorScheme` is for what CSS cannot reach, like the colors of a canvas chart: it
 * re-renders the component when the user changes theme.
 */
export function useTelegramWebApp() {
  const webApp = getWebApp();
  return {
    webApp,
    initData: webApp?.initData ?? "",
    colorScheme: useSyncExternalStore(onThemeChanged, currentColorScheme, currentColorScheme),
    /** "Close" of the PNL card (V1-26). Does nothing outside Telegram. */
    close: () => webApp?.close(),
  };
}
