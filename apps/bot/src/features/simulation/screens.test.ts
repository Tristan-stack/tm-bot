import { createUi, en, isCallbackDataSize, NAV_HOME } from "@launchbot/shared";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import { describe, expect, it } from "vitest";
import { keyboardOf, testDraft } from "../../test-harness.js";
import {
  buildBundleScreen,
  buildCustomAmountScreen,
  buildRecapScreen,
  renderBuyLines,
  renderTokenRecapBlock,
  SIM_CB,
} from "./screens.js";

const ui = createUi("devnet");

const HEADER = (step: number, bar: string) =>
  [`<b>📊 SIMULATION · STEP ${step}/3</b>`, bar, "Token › Bundle › Recap"].join("\n");

/** The token of the mockup of §6, image added, no link. */
const OTTER = {
  ...testDraft({ id: "d1" }),
  name: "Moon Otter",
  symbol: "OTTR",
  description: "An otter who loves the stars.",
  imageFileId: "file-1",
};

describe("buildBundleScreen (decision of 25/09/2026)", () => {
  it("says the dev buys 1 SOL, then asks for the bundle", () => {
    const screen = buildBundleScreen(ui, { draft: OTTER });

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱"),
        "The dev buys 1 SOL at launch, then the bundle buys in the next block. How much SOL should the bundle buy?",
        "🪙 Moon Otter · $OTTR\n💰 Dev buy: 1 SOL\n📦 Bundle: not selected yet",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "3 SOL", callback_data: "sim:b:3" },
        { text: "5 SOL", callback_data: "sim:b:5" },
        { text: "10 SOL", callback_data: "sim:b:10" },
      ],
      [{ text: "✏️ Custom", callback_data: "sim:b:c" }],
      [{ text: "⬅️ Back", callback_data: "sim:bk:tok" }],
    ]);
  });

  it("shows the bundle chosen, escapes the name, and writes a flag", () => {
    const screen = buildBundleScreen(
      ui,
      { draft: { ...OTTER, name: "Moon <Otter>" }, bundleSol: 3.5 },
      { flags: [en.sim.rateLimited.flag] },
    );

    expect(screen.text).toContain(
      "🪙 Moon &lt;Otter&gt; · $OTTR\n💰 Dev buy: 1 SOL\n📦 Bundle: 3.5 SOL",
    );
    expect(
      screen.text.endsWith("\n\n⚠️ Too many simulations. Wait a minute, then try again."),
    ).toBe(true);
  });
});

describe("buildCustomAmountScreen", () => {
  it("shows the current choices and the bounds of the bundle, with Cancel only", () => {
    const screen = buildCustomAmountScreen(
      ui,
      { draft: OTTER, bundleSol: 5 },
      { flags: [en.sim.custom.invalid] },
    );

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱"),
        "Send the bundle amount in SOL.",
        "🪙 Moon Otter · $OTTR\n💰 Dev buy: 1 SOL\n📦 Bundle: 5 SOL\nAllowed: 3 to 20 SOL, up to 3 decimals.",
        "⚠️ Invalid amount. Send a number from 3 to 20 SOL.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "❌ Cancel", callback_data: "sim:cc" }]]);
  });
});

describe("renderBuyLines", () => {
  it.each([
    [3, "9.1%", "4 SOL", "12.5%"],
    [5, "14.3%", "6 SOL", "17.7%"],
    [10, "25.1%", "11 SOL", "28.6%"],
    [20, "40.5%", "21 SOL", "43.9%"],
  ])(
    "gives the dev buy, the bundle of %s SOL and the total their shares of the curve (§7.1)",
    (bundle, bundleShare, total, totalShare) => {
      expect(renderBuyLines(FALLBACK_CURVE_PARAMS, 1, bundle)).toEqual([
        "💰 Dev buy: 1 SOL (≈ 3.4% of supply)",
        `📦 Bundle: ${bundle} SOL (≈ ${bundleShare} of supply)`,
        `🧮 Total: ${total} (≈ ${totalShare} of supply)`,
      ]);
    },
  );

  it("keeps the decimals of a Custom bundle and follows the curve it is given", () => {
    expect(renderBuyLines(FALLBACK_CURVE_PARAMS, 1, 3.5)[1]).toBe(
      "📦 Bundle: 3.5 SOL (≈ 10.4% of supply)",
    );
    // Half the virtual SOL: the same buy takes a bigger share.
    const cheaper = { ...FALLBACK_CURVE_PARAMS, virtualSol: 15 };
    expect(renderBuyLines(cheaper, 5, 0)).toEqual(["💰 Dev buy: 5 SOL (≈ 26.6% of supply)"]);
  });

  it("without a bundle (a simulation made before it, or its Run again): the dev buy alone", () => {
    expect(renderBuyLines(FALLBACK_CURVE_PARAMS, 5, 0)).toEqual([
      "💰 Dev buy: 5 SOL (≈ 15.2% of supply)",
    ]);
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
    config: { devBuySol: 1, bundleSol: 5, curve: FALLBACK_CURVE_PARAMS },
    simId: "clsim123",
  });

  it("renders the recap with the dev buy, the bundle, the total and the DEMO mention", () => {
    expect(screen.text).toBe(
      [
        HEADER(3, "▰▰▰"),
        "Check your simulation, then tap Start simulation.",
        renderTokenRecapBlock(OTTER),
        [
          "💰 Dev buy: 1 SOL (≈ 3.4% of supply)",
          "📦 Bundle: 5 SOL (≈ 14.3% of supply)",
          "🧮 Total: 6 SOL (≈ 17.7% of supply)",
          "⏱ Duration: 3 min max",
        ].join("\n"),
        "⚠️ DEMO — Bullish scenario. Not a prediction or a real result.",
      ].join("\n\n"),
    );
  });

  it("starts the Simulation of the recap with a callback button, then Back and Menu", () => {
    expect(keyboardOf(screen)).toEqual([
      [{ text: "▶️ Start simulation", callback_data: "sim:go:clsim123" }],
      [
        { text: "⬅️ Back", callback_data: "sim:bk:b" },
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
      SIM_CB.backToBundle,
    ];
    for (const data of all) expect(isCallbackDataSize(data)).toBe(true);
    expect(all).toEqual([
      "sim:open",
      "sim:b:3",
      "sim:b:10",
      "sim:b:c",
      "sim:cc",
      "sim:bk:tok",
      "sim:bk:b",
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
