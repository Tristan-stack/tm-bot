import { createUi, en, isCallbackDataSize, NAV_HOME } from "@launchbot/shared";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import { describe, expect, it } from "vitest";
import { keyboardOf, testDraft } from "../../test-harness.js";
import {
  buildCustomAmountScreen,
  buildDevBuyScreen,
  buildRecapScreen,
  formatDevBuyWithShare,
  renderTokenRecapBlock,
  SIM_CB,
} from "./screens.js";

const ui = createUi("devnet");

const HEADER = (step: number, bar: string) =>
  [`<b>📊 SIMULATION · STEP ${step}/3</b> · 🧪 Devnet`, bar, "Token › Dev buy › Recap"].join("\n");

/** The token of the mockup of §6, image added, no link. */
const OTTER = {
  ...testDraft({ id: "d1" }),
  name: "Moon Otter",
  symbol: "OTTR",
  description: "An otter who loves the stars.",
  imageFileId: "file-1",
};

describe("buildDevBuyScreen", () => {
  it("renders the mockup of §6 before a choice", () => {
    const screen = buildDevBuyScreen(ui, { draft: OTTER });

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱"),
        "How much SOL should the dev buy at launch?",
        "🪙 Moon Otter · $OTTR\n💰 Dev buy: not selected yet",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "3 SOL", callback_data: "sim:dev:3" },
        { text: "5 SOL", callback_data: "sim:dev:5" },
        { text: "10 SOL", callback_data: "sim:dev:10" },
      ],
      [{ text: "✏️ Custom", callback_data: "sim:dev:c" }],
      [{ text: "⬅️ Back", callback_data: "sim:bk:tok" }],
    ]);
  });

  it("shows the amount chosen, escapes the name, and writes a flag", () => {
    const screen = buildDevBuyScreen(
      ui,
      { draft: { ...OTTER, name: "Moon <Otter>" }, devBuySol: 2.5 },
      { flags: [en.sim.rateLimited.flag] },
    );

    expect(screen.text).toContain("🪙 Moon &lt;Otter&gt; · $OTTR\n💰 Dev buy: 2.5 SOL");
    expect(
      screen.text.endsWith("\n\n⚠️ Too many simulations. Wait a minute, then try again."),
    ).toBe(true);
  });
});

describe("buildCustomAmountScreen", () => {
  it("shows the current choice and the bounds, with Cancel only", () => {
    const screen = buildCustomAmountScreen(
      ui,
      { draft: OTTER, devBuySol: 5 },
      { flags: [en.sim.custom.invalid] },
    );

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱"),
        "Send the dev buy amount in SOL.",
        "🪙 Moon Otter · $OTTR\n💰 Dev buy: 5 SOL\nAllowed: 1 to 20 SOL, up to 3 decimals.",
        "⚠️ Invalid amount. Send a number from 1 to 20 SOL.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "❌ Cancel", callback_data: "sim:cc" }]]);
  });
});

describe("formatDevBuyWithShare", () => {
  it.each([
    [1, "1 SOL (≈ 3.4% of supply)"],
    [3, "3 SOL (≈ 9.7% of supply)"],
    [5, "5 SOL (≈ 15.2% of supply)"],
    [10, "10 SOL (≈ 26.6% of supply)"],
    [20, "20 SOL (≈ 42.7% of supply)"],
  ])("gives the share of the curve for %s SOL on the §7.1 values", (sol, expected) => {
    expect(formatDevBuyWithShare(sol, FALLBACK_CURVE_PARAMS)).toBe(expected);
  });

  it("keeps the decimals of a Custom amount and follows the curve it is given", () => {
    expect(formatDevBuyWithShare(2.5, FALLBACK_CURVE_PARAMS)).toMatch(
      /^2\.5 SOL \(≈ 8\.\d% of supply\)$/,
    );
    // Half the virtual SOL: the same dev buy takes a bigger share.
    const cheaper = { ...FALLBACK_CURVE_PARAMS, virtualSol: 15 };
    expect(formatDevBuyWithShare(5, cheaper)).toBe("5 SOL (≈ 26.6% of supply)");
  });
});

describe("renderTokenRecapBlock", () => {
  it("renders the block of the mockup", () => {
    expect(renderTokenRecapBlock(OTTER)).toBe(
      [
        "<b>🪙 TOKEN</b>",
        "┌ Moon Otter · $OTTR",
        "├ An otter who loves the stars.",
        "├ 🖼 Image: ✅",
        "└ 🔗 Links: none",
      ].join("\n"),
    );
  });

  it("skips an absent description, shows — without an image, links the links present", () => {
    const block = renderTokenRecapBlock({
      ...OTTER,
      description: null,
      imageFileId: null,
      website: "https://moon.example",
      telegram: "https://t.me/moonotter",
    });

    expect(block).toBe(
      [
        "<b>🪙 TOKEN</b>",
        "┌ Moon Otter · $OTTR",
        "├ 🖼 Image: —",
        '└ 🔗 <a href="https://moon.example">Website</a> · <a href="https://t.me/moonotter">Telegram</a>',
      ].join("\n"),
    );
  });

  it("escapes the name and the description", () => {
    expect(
      renderTokenRecapBlock({ ...OTTER, name: "<b>Otter</b>", description: "a & b" }),
    ).toContain("┌ &lt;b&gt;Otter&lt;/b&gt; · $OTTR\n├ a &amp; b");
  });
});

describe("buildRecapScreen", () => {
  const screen = buildRecapScreen(ui, {
    draft: OTTER,
    devBuySol: 5,
    curve: FALLBACK_CURVE_PARAMS,
    simId: "clsim123",
  });

  it("renders the mockup of §6 with the DEMO mention", () => {
    expect(screen.text).toBe(
      [
        HEADER(3, "▰▰▰"),
        "Check your simulation, then tap Start simulation.",
        renderTokenRecapBlock(OTTER),
        "💰 Dev buy: 5 SOL (≈ 15.2% of supply)\n⏱ Duration: 3 min max",
        "⚠️ DEMO — Bullish scenario. Not a prediction or a real result.",
      ].join("\n\n"),
    );
  });

  it("starts the Simulation of the recap with a callback button, then Back and Menu", () => {
    expect(keyboardOf(screen)).toEqual([
      [{ text: "▶️ Start simulation", callback_data: "sim:go:clsim123" }],
      [
        { text: "⬅️ Back", callback_data: "sim:bk:dev" },
        { text: "🏠 Menu", callback_data: NAV_HOME },
      ],
    ]);
  });
});

describe("SIM_CB", () => {
  it("keeps every callback data of the flow within 64 bytes", () => {
    const all = [
      SIM_CB.open,
      SIM_CB.preset(3),
      SIM_CB.preset(10),
      SIM_CB.custom,
      SIM_CB.cancelCustom,
      SIM_CB.backToToken,
      SIM_CB.backToDevBuy,
    ];
    for (const data of all) expect(isCallbackDataSize(data)).toBe(true);
    expect(all).toEqual([
      "sim:open",
      "sim:dev:3",
      "sim:dev:10",
      "sim:dev:c",
      "sim:cc",
      "sim:bk:tok",
      "sim:bk:dev",
    ]);
    // The buttons of a running simulation carry a cuid (V1-26).
    const simId = "cmfz1abcd0000abcdefghijk1";
    const live = [
      SIM_CB.go(simId),
      SIM_CB.sell(simId, 100),
      SIM_CB.pause(simId),
      SIM_CB.resume(simId),
      SIM_CB.speed(simId, 5),
      SIM_CB.again(simId),
    ];
    for (const data of live) expect(isCallbackDataSize(data)).toBe(true);
    expect(SIM_CB.sell(simId, 25)).toBe(`sim:sell:${simId}:25`);
  });
});
