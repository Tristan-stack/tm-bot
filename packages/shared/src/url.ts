export const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

/** `joinUrl("https://app.example/", "/terms")` → `https://app.example/terms`: never a double slash. */
export const joinUrl = (base: string, path: string): string =>
  `${withoutTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
