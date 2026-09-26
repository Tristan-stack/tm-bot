import type { WalletBalance } from "@launchbot/db";
import { createUi, isCallbackDataSize, solToLamports as sol } from "@launchbot/shared";
import type { Screen } from "@launchbot/shared";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import { describe, expect, it } from "vitest";
import { buttonTexts, keyboardOf, MAIN_WALLET, TEST_WALLET } from "../../test-harness.js";
import {
  buildBundleStepScreen,
  buildLaunchCustomScreen,
  buildLaunchRecapScreen,
  buildWalletStepScreen,
  LAUNCH_CB,
} from "./screens.js";
import type { LaunchRecapView } from "./screens.js";

const ui = createUi("devnet");
const HEADER = (step: number, bar: string) =>
  [`<b>🚀 LAUNCH · STEP ${step}/4</b>`, bar, "Wallet › Bundle › Token › Recap"].join("\n");

/** The wallets of the mockups with the balances of the tickets: Main 4.200 SOL, Test 0.400 SOL. */
const MAIN: WalletBalance = { ...MAIN_WALLET, lamports: sol(4.2) };
const TEST: WalletBalance = { ...TEST_WALLET, lamports: sol(0.4) };
const wallet = (name: string, lamports: bigint | null, id = name.toLowerCase()): WalletBalance => ({
  ...TEST_WALLET,
  id,
  name,
  lamports,
});
const buttons = (screen: Screen) => buttonTexts(screen.reply_markup);

describe("step 1/4 Wallet (V1-35, decision of 25/09/2026)", () => {
  const DESCRIPTION = [
    "Choose the wallet that pays the dev buy and the bundle.",
    "The smallest launch needs 4 SOL (1 SOL dev buy + 3 SOL bundle).",
  ].join("\n");

  it("lists every wallet with whether it can pay the smallest launch", () => {
    const screen = buildWalletStepScreen(ui, [MAIN, TEST]);

    expect(screen.text).toBe(
      [
        HEADER(1, "▰▱▱▱"),
        DESCRIPTION,
        "┌ Main · 4.200 SOL ✅\n└ Test · 0.400 SOL ⚠️ Insufficient funds (3.600 SOL missing)",
      ].join("\n\n"),
    );
    expect(buttons(screen)).toEqual([["Main"], ["Test"], ["⬅️ Back"]]);
    expect(keyboardOf(screen)[0]?.[0]).toMatchObject({ callback_data: "lc:w:w1" });
    expect(keyboardOf(screen)[2]?.[0]).toMatchObject({
      callback_data: "nav:home",
    });
  });

  it("rounds what is missing up, escapes a name, and says an unreadable balance", () => {
    const text = buildWalletStepScreen(ui, [
      wallet("<b>Odd</b>", 3_999_999_999n, "w3"),
      wallet("Gone", null),
    ]).text;

    expect(text).toContain(
      "┌ &lt;b&gt;Odd&lt;/b&gt; · 3.999 SOL ⚠️ Insufficient funds (0.001 SOL missing)",
    );
    expect(text).toContain("└ Gone · balance unavailable");
  });

  it("draws one wallet as the last branch", () => {
    expect(buildWalletStepScreen(ui, [MAIN]).text).toContain("\n\n└ Main · 4.200 SOL ✅");
  });

  it("sends a user without a wallet to the wallets", () => {
    const screen = buildWalletStepScreen(ui, []);

    expect(screen.text).toBe(
      [HEADER(1, "▰▱▱▱"), DESCRIPTION, "You have no wallet yet. Create or import one first."].join(
        "\n\n",
      ),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "👛 Wallets", callback_data: "wal:list" },
        { text: "⬅️ Back", callback_data: "nav:home" },
      ],
    ]);
  });
});

describe("step 2/4 Bundle (V1-36, decision of 25/09/2026)", () => {
  const LINES = [
    "┌ 3 SOL · ✅ OK",
    "├ 5 SOL · ⚠️ Insufficient funds (1.800 SOL missing)",
    "├ 10 SOL · ⚠️ Insufficient funds (6.800 SOL missing)",
    "└ Custom · 3 to 3.200 SOL with this wallet",
  ].join("\n");
  const DESCRIPTION =
    "The dev buys 1 SOL at launch, then the bundle buys in the next block. Both are paid from this wallet. Choose the bundle amount.";

  it("after a click on a bundle too high: the note and Refresh", () => {
    const screen = buildBundleStepScreen(ui, {
      wallet: MAIN,
      solUsd: 103.36,
      blockedLamports: sol(5),
    });

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱▱"),
        DESCRIPTION,
        "👛 Wallet: Main · 4.200 SOL ($434.11)\n💰 Dev buy: 1 SOL",
        LINES,
        [
          "⚠️ INSUFFICIENT FUNDS",
          "Main can't cover the 1 SOL dev buy and a 5 SOL bundle: 1.800 SOL missing.",
          "Send SOL to Main, then tap Refresh, or pick a smaller bundle.",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(buttons(screen)).toEqual([
      ["3 SOL", "5 SOL", "10 SOL"],
      ["✏️ Custom"],
      ["🔄 Refresh"],
      ["⬅️ Back"],
    ]);
  });

  it("on arrival: the lines always, no note, no Refresh; the bundle chosen before", () => {
    const screen = buildBundleStepScreen(ui, {
      wallet: MAIN,
      solUsd: null,
      bundleLamports: sol(3),
    });

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱▱"),
        DESCRIPTION,
        "👛 Wallet: Main · 4.200 SOL\n💰 Dev buy: 1 SOL\n📦 Bundle: 3 SOL",
        LINES,
      ].join("\n\n"),
    );
    expect(buttons(screen)).not.toContainEqual(["🔄 Refresh"]);
  });

  it("caps Custom at 20 SOL, and says when even the smallest bundle is out of reach", () => {
    expect(
      buildBundleStepScreen(ui, { wallet: wallet("Rich", sol(30)), solUsd: null }).text,
    ).toContain("└ Custom · 3 to 20 SOL with this wallet");
    expect(
      buildBundleStepScreen(ui, { wallet: wallet("Low", sol(3.9)), solUsd: null }).text,
    ).toContain("└ Custom · ⚠️ Insufficient funds (0.100 SOL missing)");
  });

  it("an unreadable balance asks for a Refresh", () => {
    const screen = buildBundleStepScreen(ui, { wallet: wallet("Main", null), solUsd: 103.36 });

    expect(screen.text).toContain(
      "👛 Wallet: Main · balance unavailable\n💰 Dev buy: 1 SOL\n\n⚠️ Couldn't read this wallet's balance. Tap Refresh.",
    );
    expect(buttons(screen)).toContainEqual(["🔄 Refresh"]);
  });

  it("after a Refresh: the time of the read", () => {
    const screen = buildBundleStepScreen(ui, {
      wallet: MAIN,
      solUsd: null,
      refreshedAt: new Date("2026-09-25T14:32:00Z"),
    });

    expect(screen.text).toContain(`${LINES}\n\n🕒 Updated 14:32 UTC`);
  });

  it("the Custom input: the wallet, the choices, the rules of this wallet, Cancel", () => {
    const screen = buildLaunchCustomScreen(ui, {
      wallet: MAIN,
      solUsd: 103.36,
      maxLamports: sol(3.2),
    });

    expect(screen.text).toBe(
      [
        HEADER(2, "▰▰▱▱"),
        "Send the bundle amount in SOL.",
        [
          "👛 Wallet: Main · 4.200 SOL ($434.11)",
          "💰 Dev buy: 1 SOL",
          "📦 Bundle: not selected yet",
          "Allowed: 3 to 3.200 SOL with this wallet, up to 3 decimals.",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "❌ Cancel", callback_data: "lc:b:cx" }]]);
  });
});

describe("step 4/4 Recap (V1-37)", () => {
  const view = (overrides: Partial<LaunchRecapView> = {}): LaunchRecapView => ({
    draft: {
      name: "Moon Otter",
      symbol: "OTTR",
      description: "An otter who loves the stars.",
      imageFileId: "file-id",
      website: "https://moonotter.xyz",
      twitter: "https://x.com/moonotter",
      telegram: "https://t.me/moonotter",
    },
    wallet: MAIN,
    bundleLamports: sol(3),
    curve: FALLBACK_CURVE_PARAMS,
    successUrl: "https://t.me/launchbot_success",
    createToken: "0a1b2c3d",
    ...overrides,
  });

  it("sums up the launch, and says Create token only funds a launch wallet", () => {
    const screen = buildLaunchRecapScreen(ui, view());

    expect(screen.text).toBe(
      [
        HEADER(4, "▰▰▰▰"),
        "Check everything before creating the token.",
        [
          "<b>🪙 TOKEN</b>",
          "┌ Moon Otter · $OTTR",
          "├ An otter who loves the stars.",
          "├ 🖼 Image: ✅",
          '└ 🔗 <a href="https://moonotter.xyz">Website</a> · <a href="https://x.com/moonotter">X</a> · <a href="https://t.me/moonotter">Telegram</a>',
        ].join("\n"),
        [
          "👛 Wallet: Main · 4.200 SOL",
          "💰 Dev buy: 1 SOL (≈ 3.4% of supply)",
          "📦 Bundle: 3 SOL (≈ 9.1% of supply)",
          "🧮 Total: 4 SOL (≈ 12.5% of supply)",
          "⛽ Fees: ≈ 0.05 SOL",
        ].join("\n"),
        '🏆 Your launch will be posted in the <a href="https://t.me/launchbot_success">Success channel</a>.',
        "🚧 Create token moves the dev buy and the bundle to a fresh launch wallet. The token itself arrives in V2.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "🚀 Create token", callback_data: "lc:create:0a1b2c3d" }],
      [
        { text: "⬅️ Back", callback_data: "lc:s3" },
        { text: "🏠 Menu", callback_data: "nav:home" },
      ],
    ]);
  });

  it.each([
    [5, "14.3%", "17.7%"],
    [10, "25.1%", "28.6%"],
    [20, "40.5%", "43.9%"],
  ])("computes the shares of a %s SOL bundle on the curve", (bundle, bundleShare, totalShare) => {
    const text = buildLaunchRecapScreen(ui, view({ bundleLamports: sol(bundle) })).text;
    expect(text).toContain(`📦 Bundle: ${bundle} SOL (≈ ${bundleShare} of supply)`);
    expect(text).toContain(`🧮 Total: ${bundle + 1} SOL (≈ ${totalShare} of supply)`);
  });

  it("an image missing, links missing, X alone, a name to escape", () => {
    const draft = view().draft;
    const bare = buildLaunchRecapScreen(ui, {
      ...view(),
      draft: {
        ...draft,
        name: "<b>Otter</b>",
        imageFileId: null,
        website: null,
        twitter: null,
        telegram: null,
      },
    }).text;
    expect(bare).toContain("┌ &lt;b&gt;Otter&lt;/b&gt; · $OTTR");
    expect(bare).toContain("├ 🖼 Image: —");
    expect(bare).toContain("└ 🔗 Links: none");

    const xOnly = buildLaunchRecapScreen(ui, {
      ...view(),
      draft: { ...draft, website: null, telegram: null },
    }).text;
    expect(xOnly).toContain('└ 🔗 <a href="https://x.com/moonotter">X</a>');
  });

  it("flags a wallet that no longer covers the dev buy and the bundle, and shows no USD", () => {
    const text = buildLaunchRecapScreen(ui, view({ wallet: wallet("Main", sol(2.1)) })).text;

    expect(text).toContain("👛 Wallet: Main · 2.100 SOL ⚠️ Insufficient funds (1.900 SOL missing)");
    expect(text).not.toMatch(/\(\$\d/);
  });
});

it("keeps every callback data of the flow within 64 bytes", () => {
  const all = [
    LAUNCH_CB.wallet("cmufx7liy00662kls6czue8xa"),
    LAUNCH_CB.wallet("3f0c1b2a-9d8e-4f7a-b6c5-d4e3f2a1b0c9"),
    LAUNCH_CB.preset(10),
    LAUNCH_CB.refresh,
    LAUNCH_CB.create("ffffffff"),
  ];
  for (const data of all) expect(isCallbackDataSize(data)).toBe(true);
});
