import {
  createUi,
  DAY_MS,
  en,
  getOffer,
  HOUR_MS,
  isCallbackDataSize,
  MINUTE_MS,
  OFFER_CODES,
} from "@launchbot/shared";
import type { PlanStatus, SubscriptionPeriod } from "@launchbot/shared";
import { describe, expect, it } from "vitest";
import { botHarness, callbackUpdate, feed, telegramError } from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { buildOffersScreen, buildUpgradeScreen, SUB_CB } from "./screens.js";

const ui = createUi("devnet");
const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const subscription = (plan: "CLASSIC" | "PREMIUM", expiresAt: Date): SubscriptionPeriod => ({
  plan,
  duration: "ONE_MONTH",
  startsAt: at(-DAY_MS),
  expiresAt,
});
const active = (plan: "CLASSIC" | "PREMIUM", expiresAt: Date): PlanStatus => ({
  kind: "ACTIVE",
  subscription: subscription(plan, expiresAt),
});
const NONE: PlanStatus = { kind: "NONE" };
const EXPIRED_CLASSIC: PlanStatus = { kind: "EXPIRED", subscription: subscription("CLASSIC", NOW) };

const HEADER = "<b>⭐ SUBSCRIBE</b> · 🧪 Devnet";
const DESCRIPTION = "Choose a pass to unlock Launch Coin. Prices are in USD, paid in SOL.";
const OFFERS = [
  "<b>🔹 CLASSIC</b>\n┌ 2 days · $49\n└ 1 month · $169",
  "<b>💎 PREMIUM · Best value</b>\n┌ 2 days · $59\n└ 1 month · $179",
];
const PREMIUM_ADDS = [
  "Premium adds:",
  "✅ AI token generator (AI model coming soon)",
  "✅ Up to 10 wallets",
  "✅ Priority support",
].join("\n");
const CLASSIC_LINE = "Classic: available when your Premium ends";

const offers = (
  status: PlanStatus,
  options: Partial<Parameters<typeof buildOffersScreen>[1]> = {},
) => buildOffersScreen(ui, { status, aiModelAvailable: false, now: NOW, ...options });

describe("offers screen (§8.2)", () => {
  it("shows the plans, what Premium adds and the 4 offers without a subscription", () => {
    const screen = offers(NONE);

    expect(screen.text).toBe(
      [HEADER, DESCRIPTION, "📋 Current plan: None", ...OFFERS, PREMIUM_ADDS].join("\n\n"),
    );
    expect(screen.reply_markup.inline_keyboard).toEqual([
      [
        { text: "🔹 Classic · 2 days", callback_data: "sub:buy:C2D" },
        { text: "🔹 Classic · 1 month", callback_data: "sub:buy:C1M" },
      ],
      [
        { text: "💎 Premium · 2 days", callback_data: "sub:buy:P2D" },
        { text: "💎 Premium · 1 month", callback_data: "sub:buy:P1M" },
      ],
      [{ text: "⬅️ Back", callback_data: "nav:home" }],
    ]);
  });

  it("shows the time left under 72 h, and the Classic line during Premium", () => {
    const screen = offers(active("PREMIUM", at(DAY_MS + 4 * HOUR_MS + 30 * MINUTE_MS)));

    expect(screen.text).toBe(
      [
        HEADER,
        DESCRIPTION,
        "📋 Current plan: Premium · 1d 4h left",
        ...OFFERS,
        PREMIUM_ADDS,
        CLASSIC_LINE,
      ].join("\n\n"),
    );
  });

  it("shows the end date from 72 h, and no Classic line during Classic", () => {
    const screen = offers(active("CLASSIC", new Date("2026-10-12T09:00:00Z")));

    expect(screen.text).toContain("📋 Current plan: Classic · until 12 Oct");
    expect(screen.text).not.toContain(CLASSIC_LINE);
  });

  it("says the last plan expired", () => {
    expect(offers(EXPIRED_CLASSIC).text).toContain("📋 Current plan: Classic ⚠️ expired");
  });

  it("drops « coming soon » once an AI model is plugged in", () => {
    const screen = offers(NONE, { aiModelAvailable: true });

    expect(screen.text).toContain("✅ AI token generator\n✅ Up to 10 wallets");
    expect(screen.text).not.toContain("coming soon");
  });

  it("ends with the flags of the callers, the note of the Launch Coin entry included", () => {
    const screen = offers(active("PREMIUM", at(10 * DAY_MS)), {
      flags: ["⚠️ Payments are temporarily unavailable.", en.subscribe.launchCoinNeedsPlan],
    });

    expect(
      screen.text.endsWith(
        [
          PREMIUM_ADDS,
          [
            CLASSIC_LINE,
            "⚠️ Payments are temporarily unavailable.",
            "⭐ Launch Coin needs an active subscription.",
          ].join("\n"),
        ].join("\n\n"),
      ),
    ).toBe(true);
  });
});

describe("warning Classic → Premium", () => {
  it("says the Classic time is lost, then asks", () => {
    const screen = buildUpgradeScreen(ui, {
      offer: getOffer("PREMIUM", "ONE_MONTH"),
      status: active("CLASSIC", at(DAY_MS + 4 * HOUR_MS + 30 * MINUTE_MS)),
      now: NOW,
    });

    expect(screen.text).toBe(
      [
        "<b>⭐ PREMIUM · 1 MONTH</b> · 🧪 Devnet",
        "⚠️ Your remaining Classic time will be lost.",
        "Premium starts right away when your payment is received.",
        "📋 Current plan: Classic · 1d 4h left\n💎 New plan: Premium · 1 month · $179",
      ].join("\n\n"),
    );
    expect(screen.reply_markup.inline_keyboard).toEqual([
      [
        { text: "➡️ Continue", callback_data: "sub:up:P1M" },
        { text: "❌ Cancel", callback_data: "sub:open" },
      ],
    ]);
  });

  it("keeps every callback data within 64 bytes", () => {
    for (const code of OFFER_CODES) {
      expect(isCallbackDataSize(SUB_CB.buy(code))).toBe(true);
      expect(isCallbackDataSize(SUB_CB.upgrade(code))).toBe(true);
    }
  });
});

describe("offer clicks (§8.4)", () => {
  const later = () => new Date(Date.now() + 10 * DAY_MS);
  const harness = (status: PlanStatus = NONE, replies = {}) => {
    const h = botHarness({ data: { getPlanStatus: () => Promise.resolve(status) }, replies });
    return { ...h, screen: h.api.screen, lastAlert: h.api.lastAlert };
  };

  it("opens from the menu, in place", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(MENU.subscribe, { messageId: 55 }));

    expect(h.api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(h.screen()).toContain("📋 Current plan: None");
  });

  it("refuses Classic during Premium: alert, and the line on the screen", async () => {
    const h = harness(active("PREMIUM", later()));

    await feed(h.bot, callbackUpdate(SUB_CB.buy("C2D")));

    expect(h.lastAlert()).toMatchObject({
      text: "You can switch to Classic when Premium expires.",
      show_alert: true,
    });
    expect(h.screen()).toContain(CLASSIC_LINE);
    expect(h.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
  });

  it("ignores « message is not modified » when the line is already there", async () => {
    const h = harness(active("PREMIUM", later()), {
      editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
    });

    await feed(h.bot, callbackUpdate(SUB_CB.buy("C1M")));

    expect(h.lastAlert()).toMatchObject({ show_alert: true });
    expect(h.api.of("sendMessage")).toHaveLength(0);
  });

  it("warns before Premium during Classic, then Continue opens the invoice", async () => {
    const h = harness(active("CLASSIC", later()));

    await feed(h.bot, callbackUpdate(SUB_CB.buy("P1M")));
    expect(h.screen()).toContain("⚠️ Your remaining Classic time will be lost.");

    await feed(h.bot, callbackUpdate(SUB_CB.upgrade("P1M")));
    expect(h.screen()).toContain("<b>⭐ PREMIUM · 1 MONTH</b>");
    expect(h.screen()).toContain("Send exactly");
  });

  it.each([
    ["no subscription", NONE, "C2D"],
    ["the same plan again, which extends it", active("PREMIUM", later()), "P2D"],
    ["Premium over an expired Classic", EXPIRED_CLASSIC, "P1M"],
  ] as const)("opens the invoice straight away with %s", async (_case, status, code) => {
    const h = harness(status);

    await feed(h.bot, callbackUpdate(SUB_CB.buy(code)));

    expect(h.screen()).toContain("Send exactly");
    expect(h.api.of("answerCallbackQuery").at(-1)?.payload["show_alert"]).not.toBe(true);
  });

  it("Continue after the Classic ended goes to the invoice without a warning", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(SUB_CB.upgrade("P2D")));

    expect(h.screen()).toContain("<b>⭐ PREMIUM · 2 DAYS</b>");
    expect(h.screen()).toContain("Send exactly");
  });

  it("shows the offers for an unknown offer code", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate("sub:buy:X9Z"));

    expect(h.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
  });
});
