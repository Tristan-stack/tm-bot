import { escapeHtml } from "@launchbot/shared";

/** The canvas of every picture (§6.1): 16:9, readable on a phone once Telegram scales it. */
export const WIDTH = 1280;
export const HEIGHT = 720;

/** Fixed dark theme (proposal): the picture cannot know the Telegram theme of the viewer. */
export const COLORS = {
  background: "#0f1218",
  panel: "#171c25",
  grid: "#242b37",
  text: "#e6e9ef",
  muted: "#8b93a3",
  up: "#26a69a",
  down: "#ef5350",
  /** The pill of the PNL card (V1-25, the mock-up of 24/09/2026). */
  gain: "#22c55e",
  loss: "#ef4444",
} as const;

export const FONT_FAMILY = "Inter";

/** Coordinates with two decimals at most, so the SVG stays short and stable. */
export const num = (value: number): string => String(Math.round(value * 100) / 100);

export type TextOptions = {
  size: number;
  weight?: 400 | 700;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  letterSpacing?: number;
  className?: string;
};

/** A `<text>` element; `content` is escaped here, never by the caller. */
export function text(x: number, y: number, content: string, options: TextOptions): string {
  const {
    size,
    weight = 400,
    fill = COLORS.text,
    anchor = "start",
    opacity,
    letterSpacing,
    className,
  } = options;
  const attrs = [
    `x="${num(x)}"`,
    `y="${num(y)}"`,
    `font-family="${FONT_FAMILY}"`,
    `font-size="${num(size)}"`,
    `font-weight="${weight}"`,
    `fill="${fill}"`,
    `text-anchor="${anchor}"`,
    ...(opacity === undefined ? [] : [`opacity="${num(opacity)}"`]),
    ...(letterSpacing === undefined ? [] : [`letter-spacing="${num(letterSpacing)}"`]),
    ...(className === undefined ? [] : [`class="${className}"`]),
  ];
  // Text content of an element: the HTML escaper covers what XML needs there.
  return `<text ${attrs.join(" ")}>${escapeHtml(content)}</text>`;
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  extra = "",
): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1,
): string {
  return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${num(width)}"/>`;
}

/** The image of a token as Telegram gives it; resvg decodes PNG and JPEG, not WEBP. */
export type LogoImage = { bytes: Uint8Array; type: "image/png" | "image/jpeg" };
/** A logo ready to embed: a small PNG as a data URI, made once per run by `renderLogo`. */
export type Logo = { href: string };

const BADGE_COLORS = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5e9",
  "#84cc16",
  "#f43f5e",
];

/** The color of the badge follows the ticker, so a token keeps its color from picture to picture. */
export function badgeColor(ticker: string): string {
  let hash = 0;
  for (const char of ticker) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length] ?? "#6366f1";
}

/** The logo of the token in a circle, or a badge with the first letter of the ticker. */
export function avatar(
  cx: number,
  cy: number,
  radius: number,
  ticker: string,
  logo: Logo | null,
): string {
  if (logo === null) {
    return [
      `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}" fill="${badgeColor(ticker)}" class="badge"/>`,
      text(cx, cy + radius * 0.36, (ticker[0] ?? "?").toUpperCase(), {
        size: radius * 1.05,
        weight: 700,
        anchor: "middle",
      }),
    ].join("");
  }
  const id = `logo-${num(cx)}-${num(cy)}`;
  return [
    `<clipPath id="${id}"><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}"/></clipPath>`,
    `<image href="${logo.href}" x="${num(cx - radius)}" y="${num(cy - radius)}" width="${num(radius * 2)}" height="${num(radius * 2)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" class="logo"/>`,
  ].join("");
}

/** The document around a picture: the canvas by default, dark; `background: null` is transparent. */
export function document(
  body: string,
  options: { width?: number; height?: number; background?: string | null } = {},
): string {
  const { width = WIDTH, height = HEIGHT, background = COLORS.background } = options;
  const fill = background === null ? "" : rect(0, 0, width, height, background);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fill}${body}</svg>`;
}
