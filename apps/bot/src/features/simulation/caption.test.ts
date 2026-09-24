import { createUi, TG } from "@launchbot/shared";
import { pnlCard } from "@launchbot/sim-render/test-helpers";
import { describe, expect, it } from "vitest";
import { buttonTexts } from "../../test-harness.js";
import {
  buildEndedCaption,
  buildEndedKeyboard,
  buildLiveCaption,
  buildLiveKeyboard,
  formatMarketCap,
} from "./caption.js";
import type { LiveView } from "./caption.js";

const ui = createUi("devnet");

const view = (overrides: Partial<LiveView> = {}): LiveView => ({
  token: { name: "Moon Otter", ticker: "OTTR" },
  clock: { nowSec: 92, durationSec: 180 },
  speed: 2,
  paused: false,
  solUsdPrice: 103.36,
  stats: { marketCapSol: 50.08, progress: 0.342, volumeSol: 18.402, buys: 214, sells: 97 },
  position: {
    holdText: "96.66M OTTR (9.67%)",
    valueText: "≈ 3.412 SOL ($352.66)",
    pnlText: "+0.412 SOL (+13.7%)",
    soldText: "1.234 SOL",
  },
  ...overrides,
});

describe("buildLiveCaption", () => {
  it("renders the mock-up of §6.1", () => {
    expect(buildLiveCaption(ui, view())).toBe(
      [
        "<b>📊 SIMULATION</b> · 🧪 Devnet",
        "⚠️ DEMO — Bullish scenario. Not a prediction or a real result.",
        "",
        "🪙 Moon Otter · $OTTR",
        "⏱ 1:32 / 3:00 · Speed x2",
        "",
        "📈 Market cap: $5,176.27 (50.08 SOL)",
        "Bonding curve: 34.2% ▰▰▰▱▱▱▱▱▱▱",
        "Volume: 18.402 SOL · Buys / Sells: 214 / 97",
        "",
        "💼 You hold: 96.66M OTTR (9.67%)",
        "Value if sold now: ≈ 3.412 SOL ($352.66)",
        "PnL: +0.412 SOL (+13.7%)",
        "Sold so far: 1.234 SOL",
      ].join("\n"),
    );
  });

  it("shows Paused instead of the speed, no USD without a price, no sold line before a sale", () => {
    const caption = buildLiveCaption(
      ui,
      view({
        paused: true,
        solUsdPrice: null,
        stats: { ...view().stats, progress: 1 },
        position: { ...view().position, valueText: "≈ 3.412 SOL", soldText: null },
      }),
    );
    expect(caption).toContain("⏱ 1:32 / 3:00 · ⏸ Paused");
    expect(caption).toContain("📈 Market cap: 50.08 SOL");
    expect(caption).toContain("Bonding curve: 100.0% ▰▰▰▰▰▰▰▰▰▰");
    expect(caption.replace("$OTTR", "")).not.toContain("$");
    expect(caption).not.toContain("Sold so far");
  });

  it("escapes the name and stays under the caption limit with the longest name", () => {
    const name = "<b>".repeat(10) + "&&";
    const caption = buildLiveCaption(ui, view({ token: { name, ticker: "OTTRXXXXXX" } }));
    expect(caption).toContain("🪙 &lt;b&gt;");
    expect(caption).not.toContain("<b>&");
    expect(caption.length).toBeLessThanOrEqual(TG.CAPTION_MAX_CHARS);
  });
});

describe("keyboards", () => {
  it("lists the three sales, Pause or Resume, and the speeds with the current one checked", () => {
    const running = buildLiveKeyboard("clsim1234567890abcdefghijk", { speed: 2, paused: false });
    expect(buttonTexts(running)).toEqual([
      ["Sell 25%", "Sell 50%", "Sell 100%"],
      ["⏸ Pause", "x1", "✅ x2", "x5"],
    ]);
    expect(running.inline_keyboard[0]?.[2]).toMatchObject({
      callback_data: "sim:sell:clsim1234567890abcdefghijk:100",
    });
    const paused = buildLiveKeyboard("s1", { speed: 5, paused: true });
    expect(buttonTexts(paused)[1]).toEqual(["▶️ Resume", "x1", "x2", "✅ x5"]);
    expect(buttonTexts(buildEndedKeyboard("s1"))).toEqual([["🔁 Run again", "🏠 Menu"]]);
  });
});

describe("helpers", () => {
  it("draws the market cap with and without a price", () => {
    expect(formatMarketCap(50.08, 103.36)).toBe("$5,176.27 (50.08 SOL)");
    expect(formatMarketCap(50.08, null)).toBe("50.08 SOL");
  });

  it("renders the caption of the card, with the dollars when there is a price", () => {
    expect(buildEndedCaption(ui, pnlCard())).toBe(
      [
        "<b>📊 SIMULATION ENDED</b> · 🧪 Devnet",
        "⚠️ DEMO — Bullish scenario. Not a prediction or a real result.",
        "",
        "🪙 <b>$OTTR</b> | +42.7%",
        "📈 Invested: 3.000 SOL ($310)",
        "📉 Sell: 4.283 SOL ($443)",
        "💰 Profit: +1.283 SOL ($133)",
      ].join("\n"),
    );
    const unpriced = buildEndedCaption(ui, pnlCard({ usd: null }));
    expect(unpriced).toContain("📈 Invested: 3.000 SOL\n📉 Sell: 4.283 SOL\n💰 Profit: +1.283 SOL");
    expect(unpriced).not.toContain("$3");
  });
});
