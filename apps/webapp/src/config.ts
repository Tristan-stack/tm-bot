// The only two values of the environment that reach the bundle, injected by vite.config.ts.
// Everything else in `.env` is a server secret.
declare const __TERMS_VERSION__: number;
declare const __API_URL__: string;

/** Baked in at build time: a new version of the Terms needs a new build of the Mini App. */
export const TERMS_VERSION = __TERMS_VERSION__;

/** Empty when the API is served from the same origin (single tunnel, `/api` proxy). */
export const API_URL = __API_URL__;
