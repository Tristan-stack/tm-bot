// The only value of the environment that reaches the bundle, injected by vite.config.ts.
// Everything else in `.env` is a server secret.
declare const __API_URL__: string;

/** Empty when the API is served from the same origin (single tunnel, `/api` proxy). */
export const API_URL = __API_URL__;
