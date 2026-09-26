import { z } from "zod";
import type { SolanaCluster } from "../cluster.js";
import {
  TOKEN_NAME_MAX_BYTES,
  TOKEN_SUPPLY_BASE_UNITS,
  TOKEN_TICKER_MAX_BYTES,
} from "../constants.js";
import { formatTokenAmount } from "../format/number.js";
import { formatSol, lamportsToSol } from "../format/sol.js";
import { utf8ByteLength } from "../format/text.js";
import { E } from "../i18n/emoji.js";
import { en } from "../i18n/en.js";
import { isValidSolanaAddress } from "../solana-address.js";
import { formatTicker } from "../token/display.js";
import { a, b, pre } from "../ui/html.js";

/**
 * The Success channel card (§10.4). Pure: no Telegram call, no environment.
 * A result, not a launch announcement: ticker and PnL, the full mint, invested / sell / profit.
 * Dollars only when a SOL price is passed. Nothing here can name the creator.
 * D24: the text names no network. The Solscan link still carries `?cluster=`.
 */

const HTTPS = /^https:\/\//;

const withinBytes = (max: number) => (value: string) =>
  value !== "" && utf8ByteLength(value) <= max;

/** Absent, blank or null becomes `null`. A stored link is kept as written; the formatter drops it. */
const optionalText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  });

export const successPostInputSchema = z.object({
  launchStatus: z.literal("CONFIRMED"),
  txSignature: z.string().trim().min(1),
  mint: z.string().refine(isValidSolanaAddress),
  name: z.string().refine(withinBytes(TOKEN_NAME_MAX_BYTES)),
  symbol: z
    .string()
    .refine((value) => !value.includes("$") && withinBytes(TOKEN_TICKER_MAX_BYTES)(value)),
  description: optionalText,
  imageFileId: optionalText,
  website: optionalText,
  twitter: optionalText,
  telegram: optionalText,
  /** Shown as Invested. */
  devBuyLamports: z.bigint().min(0n),
  /** Shown as Sell. Profit and the percent are sell minus invested. */
  soldLamports: z.bigint().min(0n),
  devTokens: z.bigint().min(0n),
  totalSupplyBaseUnits: z.bigint().positive().default(TOKEN_SUPPLY_BASE_UNITS),
  /** SOL price in USD. Absent: the card shows SOL only. */
  solUsd: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

/** What a caller passes. `totalSupplyBaseUnits` defaults to the pump.fun supply. */
export type SuccessPostInput = z.input<typeof successPostInputSchema>;

export type SuccessPostOptions = {
  /** `https://t.me/<bot>`. Absent: the card has no Join line. */
  botUrl?: string;
  /** DexScreener, GMGN and Solscan. Default true. */
  showLinks?: boolean;
};

/** A card copied from another channel: ticker, mint, invested and sell. No creator, no wallet. */
export type ImportedSuccessCard = {
  symbol: string;
  mint: string;
  investedLamports: bigint;
  soldLamports: bigint;
  solUsd: number | null;
};

export type SuccessPost = {
  caption: string;
  /** Set when the draft has a Telegram `file_id`. The default image is the service's business. */
  photo: { fileId?: string };
};

/** Visible caption length: tags removed, entities decoded, UTF-16 units (`string.length`). */
export function successCaptionLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&").length;
}

/** `+89%`, `-12%`, `0%`. Half up, on lamports. `invested` is greater than zero. */
function formatPnlPct(profit: bigint, invested: bigint): string {
  const negative = profit < 0n;
  const magnitude = negative ? -profit : profit;
  const pct = (magnitude * 100n + invested / 2n) / invested;
  if (pct === 0n) return "0%";
  return `${negative ? "-" : "+"}${pct}%`;
}

/** `($1.02K)` from 1,000, `($910)` below, `(-$56)` for a loss. */
function usdParen(usd: number): string {
  const negative = usd < 0;
  const abs = Math.abs(usd);
  const text = abs >= 1000 ? formatTokenAmount(abs) : String(Math.round(abs));
  return negative ? `(-$${text})` : `($${text})`;
}

function money(lamports: bigint, solUsd: number | null, signed: boolean): string {
  const sol = formatSol(lamports, { decimals: 3, rounding: "halfUp", signed });
  if (solUsd === null) return sol;
  return `${sol} ${usdParen(lamportsToSol(lamports) * solUsd)}`;
}

function solscanTokenUrl(mint: string, cluster: SolanaCluster): string {
  const base = `https://solscan.io/token/${encodeURIComponent(mint)}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${encodeURIComponent(cluster)}`;
}

function captionOf(
  data: ImportedSuccessCard,
  cluster: SolanaCluster,
  options: SuccessPostOptions,
): string {
  const texts = en.successPost;
  const invested = data.investedLamports;
  const profit = data.soldLamports - invested;
  const ticker = b(formatTicker(data.symbol));
  const headline =
    invested > 0n
      ? texts.headline(ticker, b(formatPnlPct(profit, invested)))
      : texts.tickerOnly(ticker);
  const figures = [
    texts.invested(money(invested, data.solUsd, false)),
    texts.sell(money(data.soldLamports, data.solUsd, false)),
    texts.profit(b(money(profit, data.solUsd, true))),
  ].join("\n");
  const lines = [
    headline,
    "",
    texts.mint,
    pre(data.mint),
    "",
    `<blockquote>${figures}</blockquote>`,
  ];
  const footer = [
    ...(options.botUrl !== undefined && HTTPS.test(options.botUrl)
      ? [texts.join(a(texts.joinLabel, options.botUrl))]
      : []),
    ...(options.showLinks === false ? [] : [linkRow(data.mint, cluster)]),
  ];
  if (footer.length > 0) lines.push("", ...footer);
  return lines.join("\n");
}

function linkRow(mint: string, cluster: SolanaCluster): string {
  const { links } = en.successPost;
  const row = [
    a(links.dexscreener, `https://dexscreener.com/solana/${encodeURIComponent(mint)}`),
    a(links.gmgn, `https://gmgn.ai/sol/token/${encodeURIComponent(mint)}`),
    a(links.solscan, solscanTokenUrl(mint, cluster)),
  ].join(" · ");
  return `${E.links} ${row}`;
}

/**
 * The HTML caption and the draft's `file_id`, if it has one.
 * Invested is the dev buy. Profit and the percent are sell minus invested.
 */
export function formatSuccessPost(
  input: SuccessPostInput,
  cluster: SolanaCluster,
  options: SuccessPostOptions = {},
): SuccessPost {
  const data = successPostInputSchema.parse(input);
  const fileId = data.imageFileId ?? undefined;
  return {
    caption: captionOf(
      {
        symbol: data.symbol,
        mint: data.mint,
        investedLamports: data.devBuyLamports,
        soldLamports: data.soldLamports,
        solUsd: data.solUsd,
      },
      cluster,
      options,
    ),
    photo: fileId === undefined ? {} : { fileId },
  };
}

/** The same card as a confirmed launch, for a result that is not one of ours. */
export function formatImportedSuccessPost(
  card: ImportedSuccessCard,
  cluster: SolanaCluster,
  options: SuccessPostOptions = {},
): string {
  if (!isValidSolanaAddress(card.mint)) throw new Error("The mint address is invalid");
  if (card.symbol === "" || card.symbol.includes("$")) throw new Error("The ticker is invalid");
  if (card.investedLamports < 0n || card.soldLamports < 0n) {
    throw new Error("The amounts are invalid");
  }
  return captionOf(card, cluster, options);
}
