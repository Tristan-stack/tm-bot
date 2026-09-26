import { z } from "zod";
import type { SolanaCluster } from "../cluster.js";
import { explorerAddressUrl } from "../cluster.js";
import {
  TG,
  TOKEN_NAME_MAX_BYTES,
  TOKEN_SUPPLY_BASE_UNITS,
  TOKEN_TICKER_MAX_BYTES,
} from "../constants.js";
import { formatSol } from "../format/sol.js";
import { shortAddress, utf8ByteLength } from "../format/text.js";
import { E } from "../i18n/emoji.js";
import { en } from "../i18n/en.js";
import { isValidSolanaAddress } from "../solana-address.js";
import { formatTicker } from "../token/display.js";
import { a, b, escapeHtml } from "../ui/html.js";

/**
 * The Success channel post (§10.4, V1-39). Pure: no Telegram call, no environment.
 * D24 (25/09/2026) removed the network from the header; the explorer link still carries
 * `?cluster=` from the cluster config. The post shows the dev buy only (the ticket's format).
 * Nothing here can name the creator: the input has no user and no wallet.
 */

const HTTPS = /^https:\/\//;
const ELLIPSIS = "…";

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
  devBuyLamports: z.bigint().min(0n),
  devTokens: z.bigint().min(0n),
  totalSupplyBaseUnits: z.bigint().positive().default(TOKEN_SUPPLY_BASE_UNITS),
});

/** What a caller passes. `totalSupplyBaseUnits` defaults to the pump.fun supply. */
export type SuccessPostInput = z.input<typeof successPostInputSchema>;

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

/** Hundredths of a percent, half up, on integers only: `9.67%`. */
function formatSupplyShare(devTokens: bigint, totalSupply: bigint): string {
  const hundredths = (devTokens * 10_000n + totalSupply / 2n) / totalSupply;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

/** End of a word, then `…`, inside `max` UTF-16 units. */
function truncateWords(text: string, max: number): string {
  const room = max - ELLIPSIS.length;
  if (room <= 0) return ELLIPSIS.slice(0, max);
  let slice = text.slice(0, room);
  // `string.length` counts UTF-16 units: don't leave the first half of an emoji.
  const tail = slice.charCodeAt(slice.length - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) slice = slice.slice(0, -1);
  const space = slice.lastIndexOf(" ");
  const kept = (space > 0 ? slice.slice(0, space) : slice).trimEnd();
  return `${kept}${ELLIPSIS}`;
}

type Link = { label: string; href: string | null };

function linkLine(links: Link[]): string {
  const shown = links.filter(
    (link): link is { label: string; href: string } => link.href !== null && HTTPS.test(link.href),
  );
  return `${E.links} ${shown.map((link) => a(link.label, link.href)).join(" · ")}`;
}

type PostData = z.output<typeof successPostInputSchema>;

function captionOf(data: PostData, cluster: SolanaCluster, description: string | null): string {
  const texts = en.successPost;
  const head = [
    `${E.launchCoin} ${b(texts.title)}`,
    b(`${data.name.toUpperCase()} · ${formatTicker(data.symbol)}`),
  ].join("\n\n");
  const body = [
    texts.mint(shortAddress(data.mint, 6, 4)),
    texts.devBuy(
      formatSol(data.devBuyLamports, { decimals: 2, rounding: "halfUp" }),
      formatSupplyShare(data.devTokens, data.totalSupplyBaseUnits),
    ),
  ].join("\n");
  const links = linkLine([
    { label: texts.links.explorer, href: explorerAddressUrl(data.mint, cluster) },
    { label: texts.links.website, href: data.website },
    { label: texts.links.x, href: data.twitter },
    { label: texts.links.telegram, href: data.telegram },
  ]);
  const blocks =
    description === null ? [head, body, links] : [head, escapeHtml(description), body, links];
  return blocks.join("\n\n");
}

/**
 * The HTML caption and the draft's `file_id`, if it has one.
 * A description that would push the visible caption past 1024 characters is cut at a word;
 * the header, the name, the mint, the dev buy and the links are left whole.
 */
export function formatSuccessPost(input: SuccessPostInput, cluster: SolanaCluster): SuccessPost {
  const data = successPostInputSchema.parse(input);
  const fixed = successCaptionLength(captionOf(data, cluster, null));
  // One extra blank line separates the description from the name and from the mint.
  const budget = TG.CAPTION_MAX_CHARS - fixed - 2;
  let description = data.description;
  if (description !== null && description.length > budget) {
    description = budget < 1 ? null : truncateWords(description, budget);
  }
  const fileId = data.imageFileId ?? undefined;
  return {
    caption: captionOf(data, cluster, description),
    photo: fileId === undefined ? {} : { fileId },
  };
}
