import { createUi, DAY_MS } from "@launchbot/shared";
import type { PlanStatus } from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it } from "vitest";
import { botHarness, callbackUpdate, feed, keyboardOf } from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { buildSupportScreen } from "./screens.js";

const ui = createUi("devnet");
const TELEGRAM_ID = 123_456_789n;
const SUPPORT_URL = "https://t.me/launchbot_support";

beforeEach(resetRateLimits);

const plan = (kind: "ACTIVE" | "EXPIRED", name: "CLASSIC" | "PREMIUM"): PlanStatus => ({
  kind,
  subscription: {
    plan: name,
    duration: "ONE_MONTH",
    startsAt: new Date(Date.now() - DAY_MS),
    expiresAt: new Date(Date.now() + (kind === "ACTIVE" ? DAY_MS : -60_000)),
  },
});

describe("buildSupportScreen (§11.1, V1-40)", () => {
  it("shows the code of a Premium, alone in <code>, and the priority line", () => {
    const screen = buildSupportScreen(ui, {
      plan: "PREMIUM",
      telegramId: TELEGRAM_ID,
      supportUrl: SUPPORT_URL,
    });

    expect(screen.text).toBe(
      [
        "<b>🆘 SUPPORT</b>",
        "",
        "Need help? Contact our support team.",
        "Tell us what happened, on which screen, and add a screenshot if you can.",
        "",
        "Your support code: <code>P-123456789</code>",
        "Paste it at the start of your first message.",
        "",
        "⭐ You're Premium: your requests are handled first.",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "💬 Contact support", url: `${SUPPORT_URL}?text=P-123456789` }],
      [{ text: "⬅️ Back", callback_data: "nav:home" }],
    ]);
    expect(screen.link_preview_options).toEqual({ is_disabled: true });
  });

  it.each([
    ["CLASSIC", "C-123456789"],
    [null, "F-123456789"],
  ] as const)("a %s account has the code %s and the standard line", (planName, code) => {
    const { text } = buildSupportScreen(ui, {
      plan: planName,
      telegramId: TELEGRAM_ID,
      supportUrl: SUPPORT_URL,
    });

    expect(text).toContain(`Your support code: <code>${code}</code>`);
    expect(text).toContain("⭐ Premium members are handled first.");
    expect(text).not.toContain("You're Premium");
  });
});

describe("the Support button of the menu (V1-40)", () => {
  function harness(status: PlanStatus) {
    return botHarness({ data: { getPlanStatus: () => Promise.resolve(status) } });
  }

  it("opens in place, the plan read at the click", async () => {
    const h = harness(plan("ACTIVE", "PREMIUM"));

    await feed(h.bot, callbackUpdate(MENU.support, { messageId: 55 }));

    expect(h.api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(h.api.screen()).toContain("<code>P-123456789</code>");
  });

  it("gives F to a plan past its end the worker has not expired yet", async () => {
    // `getPlanStatus` reads an ACTIVE row past its end as EXPIRED (V1-27).
    const h = harness(plan("EXPIRED", "PREMIUM"));

    await feed(h.bot, callbackUpdate(MENU.support));

    expect(h.api.screen()).toContain("<code>F-123456789</code>");
    expect(h.api.screen()).toContain("⭐ Premium members are handled first.");
  });

  it("goes back to the home screen in place", async () => {
    const h = harness({ kind: "NONE" });

    await feed(h.bot, callbackUpdate("nav:home", { messageId: 55 }));

    expect(h.api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(h.api.screen()).toContain("LAUNCH BOT");
  });
});
