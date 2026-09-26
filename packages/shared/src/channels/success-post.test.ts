import { describe, expect, it } from "vitest";
import { TG } from "../constants.js";
import { en } from "../i18n/en.js";
import { formatSuccessPost, successCaptionLength, successPostInputSchema } from "./success-post.js";
import type { SuccessPostInput } from "./success-post.js";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BOT = "https://t.me/launchbot";

const moon = {
  launchStatus: "CONFIRMED",
  txSignature:
    "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
  mint: MINT,
  name: en.successPost.example.name,
  symbol: en.successPost.example.symbol,
  description: en.successPost.example.description,
  devBuyLamports: 8_399_000_000n,
  soldLamports: 15_874_000_000n,
  devTokens: 96_657_870_000_000n,
  solUsd: 121.74,
  website: "https://moonotter.example",
  twitter: "https://x.com/moonotter",
  telegram: "https://t.me/moonotter",
} satisfies SuccessPostInput;

const visible = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

const card = [
  "🏆 $OTTR | +89%",
  "",
  "🏷 Mint",
  MINT,
  "",
  "💸 Invested: 8.399 SOL ($1.02K)",
  "💱 Sell: 15.874 SOL ($1.93K)",
  "🌟 Profit: +7.475 SOL ($910)",
  "",
  "👋 Join the bot",
  "🔗 DexScreener · GMGN · Solscan",
].join("\n");

const post = (
  overrides: Partial<SuccessPostInput> = {},
  options: { botUrl?: string } = { botUrl: BOT },
) => formatSuccessPost({ ...moon, ...overrides }, "devnet", options);

describe("formatSuccessPost (V1-39)", () => {
  it("writes the result card: ticker, full mint, invested, sell, profit, links", () => {
    const { caption } = post();

    expect(visible(caption)).toBe(card);
    expect(caption).toContain("<b>$OTTR</b>");
    expect(caption).toContain("<b>+89%</b>");
    expect(caption).toContain(`<pre>${MINT}</pre>`);
    expect(caption).toContain("<blockquote>");
    expect(caption).toContain("<b>+7.475 SOL ($910)</b>");
    expect(caption).toContain(`https://dexscreener.com/solana/${MINT}`);
    expect(caption).toContain(`https://gmgn.ai/sol/token/${MINT}`);
    expect(caption).toContain(`https://solscan.io/token/${MINT}?cluster=devnet`);
    expect(caption).toContain(`href="${BOT}"`);
    expect(successCaptionLength(caption)).toBeLessThanOrEqual(TG.CAPTION_MAX_CHARS);
  });

  it("names no network, no creator, and no launch announcement", () => {
    const { caption } = post();
    const text = visible(caption);

    expect(text).not.toMatch(/Devnet|Mainnet|🧪|NEW LAUNCH|Moon Otter|otter who loves/);
    expect(caption).toContain("cluster=devnet");
    expect(caption).not.toContain("moonotter.example");
    expect(caption).not.toContain("x.com/moonotter");
  });

  it("hides the dollars when no SOL price is passed, and the Join line without a bot url", () => {
    const text = visible(post({ solUsd: null }, {}).caption);

    expect(text).toContain("💸 Invested: 8.399 SOL\n💱 Sell: 15.874 SOL\n🌟 Profit: +7.475 SOL");
    expect(text).not.toContain("($");
    expect(text).not.toContain("Join the bot");
    expect(text).toContain("🔗 DexScreener · GMGN · Solscan");
  });

  it("drops the market links when asked, and a bot url that is not https", () => {
    const caption = formatSuccessPost(moon, "devnet", {
      botUrl: "http://t.me/launchbot",
      showLinks: false,
    }).caption;

    expect(visible(caption)).not.toContain("DexScreener");
    expect(visible(caption)).not.toContain("Join the bot");
    expect(caption).not.toContain("http://t.me/launchbot");
  });

  it("escapes a ticker with HTML", () => {
    const { caption } = post({ symbol: "OT<T>" });

    expect(visible(caption)).toContain("🏆 $OT<T> | +89%");
    expect(caption).toContain("$OT&lt;T&gt;");
  });

  it.each([
    [3_000_000_000n, 5_670_000_000n, "+89%", "+2.670 SOL"],
    [3_000_000_000n, 1_000_000_000n, "-67%", "-2.000 SOL"],
    [3_000_000_000n, 3_000_000_000n, "0%", "0.000 SOL"],
  ] as const)("shows %s invested and %s sold as %s (%s)", (invested, sold, pct, profit) => {
    expect(
      visible(post({ devBuyLamports: invested, soldLamports: sold, solUsd: null }).caption),
    ).toContain(`🏆 $OTTR | ${pct}`);
    expect(
      visible(post({ devBuyLamports: invested, soldLamports: sold, solUsd: null }).caption),
    ).toContain(`Profit: ${profit}`);
  });

  it("omits the percent when nothing was invested", () => {
    const text = visible(
      post({ devBuyLamports: 0n, soldLamports: 1_000_000_000n, solUsd: null }).caption,
    );

    expect(text.startsWith("🏆 $OTTR\n")).toBe(true);
    expect(text).not.toContain("|");
    expect(text).toContain("🌟 Profit: +1.000 SOL");
  });

  it("rejects a launch that is not confirmed, or that has no sell", () => {
    const { soldLamports: _sold, ...withoutSell } = moon;
    void _sold;

    expect(successPostInputSchema.safeParse({ ...moon, launchStatus: "SIMULATED" }).success).toBe(
      false,
    );
    expect(successPostInputSchema.safeParse(withoutSell).success).toBe(false);
    expect(successPostInputSchema.safeParse({ ...moon, mint: "not-an-address" }).success).toBe(
      false,
    );
    expect(successPostInputSchema.safeParse({ ...moon, txSignature: "" }).success).toBe(false);
    expect(successPostInputSchema.safeParse({ ...moon, solUsd: 0 }).success).toBe(false);
    expect(() =>
      formatSuccessPost(
        { ...moon, launchStatus: "SIMULATED" } as unknown as SuccessPostInput,
        "devnet",
      ),
    ).toThrow();
    expect(() => formatSuccessPost(withoutSell as SuccessPostInput, "devnet")).toThrow();
  });

  it("has no field a creator's name could arrive in", () => {
    expect(Object.keys(successPostInputSchema.shape)).toEqual([
      "launchStatus",
      "txSignature",
      "mint",
      "name",
      "symbol",
      "description",
      "imageFileId",
      "website",
      "twitter",
      "telegram",
      "devBuyLamports",
      "soldLamports",
      "devTokens",
      "totalSupplyBaseUnits",
      "solUsd",
    ]);
    expect(post().caption).not.toMatch(/Moon Otter|@/);
  });

  it("returns the draft file id and nothing when the draft has no image", () => {
    expect(post({ imageFileId: "photo-1" }).photo).toEqual({ fileId: "photo-1" });
    expect(post().photo).toEqual({});
    expect(post({ imageFileId: "  " }).photo).toEqual({});
  });
});
