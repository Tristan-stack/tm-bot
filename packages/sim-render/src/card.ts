import { en } from "@launchbot/shared";
import type { PnlCardModel, Tone } from "./model.js";
import { avatar, COLORS, document, num, rect, text } from "./svg.js";
import type { Logo } from "./svg.js";

/** The canvas of the card: the clip it is drawn over (`assets/pnl-card.mp4`), 1280 × 944. */
export const CARD_WIDTH = 1280;
export const CARD_HEIGHT = 944;

// Geometry of the overlay (the mock-up: ticker, PnL band, three rows, emblem top right).
const MARGIN = 64;
const TICKER_Y = 150;
const PILL_Y = TICKER_Y + 36;
const PILL_HEIGHT = 108;
const PILL_RADIUS = 20;
const PILL_PAD = 28;
const PILL_GLYPH = 52;
const PILL_FONT = 76;
const ROWS_Y = CARD_HEIGHT - 232;
const ROW_STEP = 66;
const ROW_FONT = 34;
const ROW_VALUE_X = MARGIN + 270;
const ROW_GLYPH = 26;
const NOT_REAL_Y = CARD_HEIGHT - 28;
const EMBLEM_RADIUS = 56;
/** Digits of Inter Bold are about 0.6 em wide, the sign a little less: the pill hugs the amount. */
const DIGIT_EM = 0.6;

const toneColor = (tone: Tone): string =>
  tone === "positive" ? COLORS.gain : tone === "negative" ? COLORS.loss : COLORS.muted;

/** The Solana mark (three bars), from the official 398 × 312 artwork, drawn `size` px wide. */
export function solanaGlyph(x: number, y: number, size: number, fill: string): string {
  const scale = size / 398;
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${num(scale)})" fill="${fill}" class="sol-glyph"><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></g>`;
}

/** A SOL amount with the mark before it: `≡ 2.433`. */
function solAmount(x: number, y: number, value: string, size: number, glyph: number): string {
  return [
    solanaGlyph(x, y - glyph * 0.82, glyph, COLORS.text),
    text(x + glyph + glyph * 0.45, y, value, { size, weight: 700, className: "sol-amount" }),
  ].join("");
}

/**
 * The PNL card (§6.3): a transparent overlay for the clip. A dark veil on the left keeps the
 * text readable over the black-and-white ink, then the ticker, the PnL in SOL on a green (or
 * red) pill, PNL / Invested / Position, the token top right. No DEMO band on this picture
 * (Tristan, 24/09/2026): the caption under it carries the mention.
 */
export function buildPnlCardSvg(card: PnlCardModel, logo: Logo | null): string {
  const { image } = en.sim;
  const color = toneColor(card.tone);
  const pillWidth =
    PILL_PAD +
    PILL_GLYPH +
    PILL_GLYPH * 0.45 +
    card.pnlSolBig.length * PILL_FONT * DIGIT_EM +
    PILL_PAD;
  const rows: [string, string, boolean][] = [
    [image.pnl, card.pnlPctText, false],
    [image.invested, card.investedText, true],
    [image.position, card.positionSolText, true],
  ];
  const parts: string[] = [
    `<defs><linearGradient id="veil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${COLORS.background}" stop-opacity="0.92"/><stop offset="0.55" stop-color="${COLORS.background}" stop-opacity="0.55"/><stop offset="1" stop-color="${COLORS.background}" stop-opacity="0.15"/></linearGradient></defs>`,
    rect(0, 0, CARD_WIDTH, CARD_HEIGHT, "url(#veil)", 'class="veil"'),
    text(MARGIN, TICKER_Y, card.tickerText, { size: 72, weight: 700, className: "ticker" }),
    rect(MARGIN, PILL_Y, pillWidth, PILL_HEIGHT, color, `rx="${PILL_RADIUS}" class="pill"`),
    solanaGlyph(
      MARGIN + PILL_PAD,
      PILL_Y + (PILL_HEIGHT - PILL_GLYPH * 0.78) / 2,
      PILL_GLYPH,
      COLORS.text,
    ),
    text(
      MARGIN + PILL_PAD + PILL_GLYPH + PILL_GLYPH * 0.45,
      PILL_Y + PILL_HEIGHT / 2 + PILL_FONT * 0.36,
      card.pnlSolBig,
      {
        size: PILL_FONT,
        weight: 700,
        className: "pnl-sol",
      },
    ),
    avatar(CARD_WIDTH - MARGIN - EMBLEM_RADIUS, TICKER_Y - 24, EMBLEM_RADIUS, card.ticker, logo),
    ...rows.flatMap(([label, value, sol], index) => {
      const y = ROWS_Y + index * ROW_STEP;
      return [
        text(MARGIN, y, label, { size: ROW_FONT, fill: COLORS.muted, className: "row-label" }),
        sol
          ? solAmount(ROW_VALUE_X, y, value, ROW_FONT, ROW_GLYPH)
          : text(ROW_VALUE_X, y, value, { size: ROW_FONT, weight: 700, className: "row-value" }),
      ];
    }),
    text(MARGIN, NOT_REAL_Y, `${image.watermark} · ${image.notReal}`, {
      size: 20,
      fill: COLORS.muted,
      className: "not-real",
    }),
  ];
  return document(parts.join(""), { width: CARD_WIDTH, height: CARD_HEIGHT, background: null });
}
