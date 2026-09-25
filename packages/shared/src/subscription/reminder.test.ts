import { describe, expect, it } from "vitest";
import { SUB_OPEN } from "../callback.js";
import { DAY_MS, HOUR_MS, MINUTE_MS, TG } from "../constants.js";
import { createUi } from "../ui/index.js";
import { buildReminderScreen, reminderLeadMs } from "./reminder.js";

const END = new Date("2026-09-17T14:32:00Z");
const before = (ms: number) => new Date(END.getTime() - ms);
const ui = createUi("devnet");

describe("reminderLeadMs (§8.4)", () => {
  it("is 24 h for a month and 6 h for a 2-day pass", () => {
    expect(reminderLeadMs("ONE_MONTH")).toBe(24 * HOUR_MS);
    expect(reminderLeadMs("TWO_DAYS")).toBe(6 * HOUR_MS);
  });
});

describe("buildReminderScreen", () => {
  const period = (plan: "CLASSIC" | "PREMIUM") => ({
    plan,
    duration: "TWO_DAYS" as const,
    startsAt: before(2 * DAY_MS),
    expiresAt: END,
  });

  it("names the plan, its time left as on the home screen and its end in UTC", () => {
    const screen = buildReminderScreen(ui, period("PREMIUM"), before(5 * HOUR_MS + 59 * MINUTE_MS));

    expect(screen.text).toBe(
      [
        "<b>⭐ SUBSCRIPTION ENDING</b>",
        "Your Premium plan ends soon. Renew it to keep access to Launch Coin.",
        "⭐ Premium · 5h left\n🕒 Ends 17 Sep 2026, 14:32 UTC",
        "Buying the same plan again extends your current plan.",
      ].join("\n\n"),
    );
    expect(screen.text.length).toBeLessThan(TG.MESSAGE_MAX_CHARS);
  });

  it("has Renew as its only button, on the offers of the bot", () => {
    const screen = buildReminderScreen(ui, period("CLASSIC"), before(23 * HOUR_MS));

    expect(screen.text).toContain("Your Classic plan ends soon.");
    expect(screen.text).toContain("⭐ Classic · 23h left");
    expect(screen.reply_markup.inline_keyboard).toEqual([
      [{ text: "🔄 Renew", callback_data: SUB_OPEN }],
    ]);
    expect(SUB_OPEN).toBe("sub:open");
  });
});
