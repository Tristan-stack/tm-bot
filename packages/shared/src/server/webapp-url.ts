import { joinUrl } from "../url.js";

/** The pages the Mini App serves: the only targets of a `web_app` button. */
export type WebAppPath = "/terms" | "/privacy" | `/sim/${string}`;

/**
 * URL of a `web_app` button (V1-06, V1-08, V1-22). `webAppUrl` is `env.WEBAPP_URL`, which is
 * https: Telegram opens nothing else.
 */
export const buildWebAppUrl = (path: WebAppPath, webAppUrl: string): string =>
  joinUrl(webAppUrl, path);
