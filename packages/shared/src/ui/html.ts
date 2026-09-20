/**
 * Telegram HTML. Every helper escapes its arguments: any user value (token, wallet name,
 * username, link) goes through them. Unescaped HTML makes Telegram answer 400
 * "can't parse entities".
 */
export const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const b = (text: string): string => `<b>${escapeHtml(text)}</b>`;

/** Copied with one tap in Telegram. */
export const code = (text: string): string => `<code>${escapeHtml(text)}</code>`;

export const a = (label: string, url: string): string =>
  `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
