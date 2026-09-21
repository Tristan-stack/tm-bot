import { joinUrl } from "../url.js";
import { loadEnv } from "./env.js";

/** The pages the Mini App serves: the only targets of a `web_app` button. */
export type WebAppPath = "/terms" | "/privacy" | `/sim/${string}`;

/** URL of a `web_app` button (V1-06, V1-08, V1-22). Telegram only opens https URLs. */
export const buildWebAppUrl = (path: WebAppPath): string => joinUrl(loadEnv().WEBAPP_URL, path);
