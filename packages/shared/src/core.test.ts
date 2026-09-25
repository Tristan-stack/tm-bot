import { describe, expect, it } from "vitest";
import {
  explorerAddressUrl,
  explorerTxUrl,
  getClusterConfig,
  SOLANA_CLUSTERS,
  UnsupportedClusterError,
} from "./cluster.js";
import {
  BUNDLE_MAX_SOL,
  BUNDLE_MIN_SOL,
  BUNDLE_PRESETS_SOL,
  CACHE_TTL_MS,
  DEV_BUY_LAMPORTS,
  INACTIVITY_DELETE_MS,
  INVOICE_TTL_MS,
  LAMPORTS_PER_SOL,
  PLAN_DURATION_MS,
  PRICES_USD,
  RATE_LIMITS,
  TG,
  WALLET_LIMITS,
  WALLET_READY_MIN_LAMPORTS,
} from "./constants.js";
import { utf8ByteLength } from "./format/text.js";
import { E } from "./i18n/emoji.js";
import { en } from "./i18n/en.js";

describe("cluster", () => {
  it("describes devnet", () => {
    expect(getClusterConfig("devnet")).toEqual({
      badge: "🧪 Devnet",
      networkName: "Devnet",
      explorerCluster: "devnet",
      genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    });
  });

  it("refuses every other cluster in V1", () => {
    for (const cluster of SOLANA_CLUSTERS.filter((name) => name !== "devnet")) {
      expect(() => getClusterConfig(cluster)).toThrow(UnsupportedClusterError);
    }
  });

  it("builds explorer links", () => {
    expect(explorerAddressUrl("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "devnet")).toBe(
      "https://explorer.solana.com/address/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU?cluster=devnet",
    );
    expect(explorerTxUrl("5sig", "devnet")).toBe(
      "https://explorer.solana.com/tx/5sig?cluster=devnet",
    );
  });
});

describe("constants", () => {
  it("derives the ready-wallet minimum from the dev buy + the smallest bundle (D13)", () => {
    expect(DEV_BUY_LAMPORTS).toBe(LAMPORTS_PER_SOL);
    expect(WALLET_READY_MIN_LAMPORTS).toBe(
      DEV_BUY_LAMPORTS + BigInt(BUNDLE_MIN_SOL) * LAMPORTS_PER_SOL,
    );
    expect(WALLET_READY_MIN_LAMPORTS).toBe(4_000_000_000n);
  });

  it("holds the prices, limits and delays of the context", () => {
    expect(PRICES_USD).toEqual({
      CLASSIC: { TWO_DAYS: 49, ONE_MONTH: 169 },
      PREMIUM: { TWO_DAYS: 59, ONE_MONTH: 179 },
    });
    expect(WALLET_LIMITS).toEqual({ NONE: 3, CLASSIC: 5, PREMIUM: 10 });
    expect(PLAN_DURATION_MS.TWO_DAYS).toBe(172_800_000);
    expect(PLAN_DURATION_MS.ONE_MONTH).toBe(2_592_000_000);
    expect(INVOICE_TTL_MS).toBe(1_800_000);
    // 24 h since 25/09/2026 (48 h in the decision of 16/09/2026).
    expect(INACTIVITY_DELETE_MS).toBe(86_400_000);
    expect(CACHE_TTL_MS.solPriceMaxStale).toBe(600_000);
  });

  it("keeps the bundle presets inside the allowed range", () => {
    for (const preset of BUNDLE_PRESETS_SOL) {
      expect(preset).toBeGreaterThanOrEqual(BUNDLE_MIN_SOL);
      expect(preset).toBeLessThanOrEqual(BUNDLE_MAX_SOL);
    }
  });

  it("defines positive rate limits", () => {
    for (const { limit, windowMs } of Object.values(RATE_LIMITS)) {
      expect(limit).toBeGreaterThan(0);
      expect(windowMs).toBeGreaterThan(0);
    }
    expect(RATE_LIMITS.global).toEqual({ limit: 20, windowMs: 10_000 });
  });
});

describe("texts", () => {
  it("delivers the common buttons and texts", () => {
    expect(en.btn).toEqual({
      back: "⬅️ Back",
      menu: "🏠 Menu",
      cancel: "❌ Cancel",
      continue: "➡️ Continue",
      confirm: "✅ Confirm",
      refresh: "🔄 Refresh",
    });
    expect(en.common.alreadyUpToDate).toBe("Already up to date");
    expect(en.common.updated("14:32 UTC")).toBe("🕒 Updated 14:32 UTC");
    expect(en.plans.PREMIUM).toBe("Premium");
    expect(en.durations.TWO_DAYS).toBe("2 days");
  });

  it("keeps every callback alert within 200 characters", () => {
    // Every `{ alert, flag }` pair of the file, wherever it sits.
    const pairedAlerts = (node: unknown): string[] => {
      if (typeof node !== "object" || node === null) return [];
      const own = "alert" in node && typeof node.alert === "string" ? [node.alert] : [];
      return [...own, ...Object.values(node).flatMap(pairedAlerts)];
    };
    // `common` texts are also answered to callback queries by the router (V1-04).
    const alerts = [
      ...pairedAlerts(en),
      ...Object.values(en.common).filter((text) => typeof text === "string"),
    ];
    expect(pairedAlerts(en)).toContain(en.access.channel.notJoined.alert);

    expect(alerts.length).toBeGreaterThan(0);
    for (const text of alerts) expect(text.length).toBeLessThanOrEqual(TG.CALLBACK_ALERT_MAX_CHARS);
  });

  it("keeps button labels short enough for a keyboard", () => {
    for (const label of Object.values(en.btn)) expect(utf8ByteLength(label)).toBeLessThan(64);
  });

  it("has no empty emoji", () => {
    for (const emoji of Object.values(E)) expect(emoji).not.toBe("");
    expect(E.devnet).toBe("🧪");
    expect(E.ok).toBe("✅");
  });
});
