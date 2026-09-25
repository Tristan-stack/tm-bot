import { TOKEN_LINK_DISPLAY_MAX_CHARS } from "../constants.js";
import { codePointLength } from "../format/text.js";
import { en } from "../i18n/en.js";

export type RequiredTokenField = "name" | "ticker";

/** §5: Continue needs a name and a ticker; the description is not required. */
export function missingRequiredFields(draft: {
  name: string | null;
  symbol: string | null;
}): RequiredTokenField[] {
  const missing: RequiredTokenField[] = [];
  if (draft.name === null || draft.name === "") missing.push("name");
  if (draft.symbol === null || draft.symbol === "") missing.push("ticker");
  return missing;
}

/** The draft Continue accepts (§5): a name and a ticker. `null` is a draft never written. */
export const hasNameAndTicker = <T extends { name: string | null; symbol: string | null }>(
  draft: T | null,
): draft is T & { name: string; symbol: string } =>
  draft !== null && missingRequiredFields(draft).length === 0;

/** `OTTR` → `$OTTR`. The symbol is stored without `$`. */
export const formatTicker = (symbol: string): string => `$${symbol}`;

const X_COMMUNITY = /^https:\/\/x\.com\/i\/communities\/[0-9]+$/;
const INVITE_HASH_SHOWN = 4;

/** `Array.from` counts code points: an emoji in a path is never cut in two. */
function truncate(text: string, max: number): string {
  if (codePointLength(text) <= max) return text;
  return `${Array.from(text)
    .slice(0, max - 1)
    .join("")}…`;
}

/**
 * The short form of a stored link, for the token block of a screen:
 * website → `moon.com/about` (no `https://`, cut at 40 characters with `…`, proposal);
 * x → `@moonotter` or `X community`; telegram → `t.me/moonotter` or `t.me/+AbCd…`.
 */
export function formatLinkForDisplay(field: "website" | "x" | "telegram", value: string): string {
  switch (field) {
    case "website":
      return truncate(value.replace(/^https:\/\//i, ""), TOKEN_LINK_DISPLAY_MAX_CHARS);
    case "x":
      return X_COMMUNITY.test(value)
        ? en.token.xCommunity
        : `@${value.slice(value.lastIndexOf("/") + 1)}`;
    case "telegram": {
      const path = value.slice("https://".length);
      return path.includes("/+")
        ? `${path.slice(0, path.indexOf("/+") + 2 + INVITE_HASH_SHOWN)}…`
        : path;
    }
  }
}
