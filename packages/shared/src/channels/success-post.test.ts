import { describe, expect, it } from "vitest";
import { getClusterConfig } from "../cluster.js";
import { TG } from "../constants.js";
import { en } from "../i18n/en.js";
import { formatSuccessPost, successCaptionLength, successPostInputSchema } from "./success-post.js";
import type { SuccessPostInput } from "./success-post.js";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const moon = {
  launchStatus: "CONFIRMED",
  txSignature:
    "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
  mint: MINT,
  name: en.successPost.example.name,
  symbol: en.successPost.example.symbol,
  description: en.successPost.example.description,
  devBuyLamports: 3_000_000_000n,
  devTokens: 96_657_870_000_000n,
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

const post = (overrides: Partial<SuccessPostInput> = {}) =>
  formatSuccessPost({ ...moon, ...overrides }, "devnet");

describe("formatSuccessPost (V1-39)", () => {
  it("writes the Moon Otter post of §10.4, with the title and the name in bold", () => {
    const { caption } = post();

    expect(visible(caption)).toBe(
      [
        "🚀 NEW LAUNCH",
        "",
        "MOON OTTER · $OTTR",
        "",
        "An otter who loves the stars.",
        "",
        "🪙 Mint: 7xKXtg…gAsU",
        "💰 Dev buy: 3.00 SOL (9.67% of supply)",
        "",
        "🔗 Explorer · Website · X · Telegram",
      ].join("\n"),
    );
    expect(caption).toContain("<b>NEW LAUNCH</b>");
    expect(caption).toContain("<b>MOON OTTER · $OTTR</b>");
    expect(caption).toContain(
      `https://explorer.solana.com/address/${MINT}?cluster=${getClusterConfig("devnet").explorerCluster}`,
    );
    expect(caption).toContain('href="https://moonotter.example"');
    expect(caption).toContain('href="https://x.com/moonotter"');
    expect(caption).toContain('href="https://t.me/moonotter"');
  });

  it("names no network in the text (D24): the cluster only chooses the explorer link", () => {
    const { caption } = post();

    expect(visible(caption)).not.toMatch(/Devnet|Mainnet|🧪/);
    expect(caption).toContain("cluster=devnet");
  });

  it("drops an empty description and the blank line that went with it", () => {
    expect(visible(post({ description: null }).caption)).toBe(
      [
        "🚀 NEW LAUNCH",
        "",
        "MOON OTTER · $OTTR",
        "",
        "🪙 Mint: 7xKXtg…gAsU",
        "💰 Dev buy: 3.00 SOL (9.67% of supply)",
        "",
        "🔗 Explorer · Website · X · Telegram",
      ].join("\n"),
    );
    expect(visible(post({ description: "   " }).caption)).not.toContain("otter");
  });

  it.each([
    [{}, "🔗 Explorer"],
    [{ website: moon.website }, "🔗 Explorer · Website"],
    [{ twitter: moon.twitter }, "🔗 Explorer · X"],
    [{ telegram: moon.telegram }, "🔗 Explorer · Telegram"],
    [{ website: moon.website, twitter: moon.twitter }, "🔗 Explorer · Website · X"],
    [{ website: moon.website, telegram: moon.telegram }, "🔗 Explorer · Website · Telegram"],
    [{ twitter: moon.twitter, telegram: moon.telegram }, "🔗 Explorer · X · Telegram"],
    [
      { website: moon.website, twitter: moon.twitter, telegram: moon.telegram },
      "🔗 Explorer · Website · X · Telegram",
    ],
  ] as const)("joins only the links that exist (%j)", (links, line) => {
    const caption = visible(
      post({ website: null, twitter: null, telegram: null, ...links }).caption,
    );
    expect(caption.endsWith(line)).toBe(true);
  });

  it("escapes a name with emoji and HTML, and drops a link that is not https", () => {
    const { caption } = post({
      name: "Moon <&> 🚀",
      website: "http://moonotter.example",
      twitter: 'https://moonotter.example/?a=1&b="x"',
      telegram: null,
    });

    expect(visible(caption)).toContain("MOON <&> 🚀 · $OTTR");
    expect(caption).toContain("MOON &lt;&amp;&gt; 🚀");
    expect(caption).not.toContain("http://moonotter.example");
    expect(caption).toContain("a=1&amp;b=&quot;x&quot;");
    expect(visible(caption)).toContain("🔗 Explorer · X");
    expect(visible(caption)).not.toContain("Website");
    expect(visible(caption)).not.toContain("Telegram");
  });

  it("keeps a very long description inside 1024 visible characters, and leaves the rest whole", () => {
    const { caption } = post({ description: `${"moon ".repeat(599)}ENDMARKER` });
    const text = visible(caption);

    expect(text.length).toBeLessThanOrEqual(TG.CAPTION_MAX_CHARS);
    expect(successCaptionLength(caption)).toBe(text.length);
    expect(text).not.toContain("ENDMARKER");
    expect(text.startsWith("🚀 NEW LAUNCH")).toBe(true);
    expect(text).toContain("MOON OTTER · $OTTR");
    expect(text).toContain("🪙 Mint: 7xKXtg…gAsU");
    expect(text).toContain("💰 Dev buy: 3.00 SOL (9.67% of supply)");
    expect(text.endsWith("🔗 Explorer · Website · X · Telegram")).toBe(true);
    expect(text).toContain("…");
  });

  it.each([
    [1_000_000_000n, 34_280_000_000_000n, "1.00 SOL", "3.43%"],
    [3_000_000_000n, 96_657_870_000_000n, "3.00 SOL", "9.67%"],
    [20_000_000_000n, 426_610_000_000_000n, "20.00 SOL", "42.66%"],
  ] as const)("shows %s lamports as %s (%s of supply)", (lamports, tokens, sol, share) => {
    expect(visible(post({ devBuyLamports: lamports, devTokens: tokens }).caption)).toContain(
      `💰 Dev buy: ${sol} (${share} of supply)`,
    );
  });

  it("rounds a dev buy past 2 decimals half up", () => {
    expect(visible(post({ devBuyLamports: 1_005_000_000n }).caption)).toContain("1.01 SOL");
    expect(visible(post({ devBuyLamports: 1_004_000_000n }).caption)).toContain("1.00 SOL");
  });

  it("rejects a launch that is not confirmed, or that has no dev tokens", () => {
    const { devTokens: _devTokens, ...withoutTokens } = moon;
    void _devTokens;

    expect(successPostInputSchema.safeParse({ ...moon, launchStatus: "SIMULATED" }).success).toBe(
      false,
    );
    expect(successPostInputSchema.safeParse(withoutTokens).success).toBe(false);
    expect(successPostInputSchema.safeParse({ ...moon, mint: "not-an-address" }).success).toBe(
      false,
    );
    expect(successPostInputSchema.safeParse({ ...moon, txSignature: "" }).success).toBe(false);
    expect(() =>
      formatSuccessPost(
        { ...moon, launchStatus: "SIMULATED" } as unknown as SuccessPostInput,
        "devnet",
      ),
    ).toThrow();
    expect(() => formatSuccessPost(withoutTokens as SuccessPostInput, "devnet")).toThrow();
  });

  it("has no field a creator's name or a performance figure could arrive in", () => {
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
      "devTokens",
      "totalSupplyBaseUnits",
    ]);
    expect(post().caption).not.toMatch(/market cap|holders|PnL|100x/i);
  });

  it("returns the draft file id and nothing when the draft has no image", () => {
    expect(post({ imageFileId: "photo-1" }).photo).toEqual({ fileId: "photo-1" });
    expect(post().photo).toEqual({});
    expect(post({ imageFileId: "  " }).photo).toEqual({});
  });
});
