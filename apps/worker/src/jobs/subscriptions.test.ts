import type { DueReminder, ReminderService } from "@launchbot/db";
import { createUi, HOUR_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SendResult, TelegramSender } from "../telegram.js";
import { createSubscriptionJobs } from "./subscriptions.js";

const NOW = new Date("2026-09-17T08:32:00Z");

afterEach(() => {
  setLogDestination(undefined);
});

const reminder = (id: string, overrides: Partial<DueReminder> = {}): DueReminder => ({
  id,
  telegramId: 123_456_789n,
  plan: "PREMIUM",
  duration: "TWO_DAYS",
  startsAt: new Date(NOW.getTime() - 42 * HOUR_MS),
  expiresAt: new Date(NOW.getTime() + 5 * HOUR_MS),
  ...overrides,
});

function setup(due: DueReminder[], results: SendResult[], claims: boolean[] = []) {
  const reminders = {
    listDue: vi.fn(() => Promise.resolve(due)),
    claim: vi.fn(() => Promise.resolve(claims.shift() ?? true)),
    release: vi.fn<ReminderService["release"]>(() => Promise.resolve()),
  } satisfies ReminderService;
  const sendScreen = vi.fn<TelegramSender["sendScreen"]>(() =>
    Promise.resolve(results.shift() ?? { ok: true, messageId: 1 }),
  );
  const expireDueSubscriptions = vi.fn(() =>
    Promise.resolve([{ id: "s1", userId: "u1", plan: "CLASSIC" as const }]),
  );
  const jobs = createSubscriptionJobs({
    reminders,
    subscriptions: { expireDueSubscriptions },
    telegram: { sendScreen },
    ui: createUi("devnet"),
    now: () => NOW,
  });
  return { jobs, reminders, sendScreen, expireDueSubscriptions };
}

describe("subscriptions.remind (V1-34)", () => {
  it("claims each reminder before its send, and sends the reminder screen", async () => {
    const { jobs, reminders, sendScreen } = setup([reminder("s1")], []);

    await expect(jobs.remind()).resolves.toEqual({ due: 1, sent: 1 });

    expect(reminders.claim.mock.invocationCallOrder[0]).toBeLessThan(
      sendScreen.mock.invocationCallOrder[0] ?? 0,
    );
    const [telegramId, screen] = sendScreen.mock.calls[0] ?? [];
    expect(telegramId).toBe(123_456_789n);
    expect(screen?.text).toContain("Your Premium plan ends soon.");
    expect(screen?.text).toContain("⭐ Premium · 5h left");
  });

  it("sends nothing another run already claimed", async () => {
    const { jobs, sendScreen } = setup([reminder("s1")], [], [false]);

    await expect(jobs.remind()).resolves.toEqual({ due: 1, sent: 0 });
    expect(sendScreen).not.toHaveBeenCalled();
  });

  it("keeps the claim of a user who blocked the bot, releases one that may pass", async () => {
    const { jobs, reminders } = setup(
      [reminder("blocked"), reminder("network"), reminder("limited")],
      [
        { ok: false, reason: "BLOCKED" },
        { ok: false, reason: "ERROR" },
        { ok: false, reason: "RATE_LIMITED" },
      ],
    );

    await expect(jobs.remind()).resolves.toEqual({ due: 3, sent: 0 });

    expect(reminders.release.mock.calls.map(([due]) => due.id)).toEqual(["network", "limited"]);
  });
});

describe("subscriptions.expire (V1-34)", () => {
  it("expires through V1-27 and logs how many", async () => {
    const lines = captureLogs();
    const { jobs, expireDueSubscriptions } = setup([], []);

    await expect(jobs.expire()).resolves.toBe(1);

    expect(expireDueSubscriptions).toHaveBeenCalledWith(NOW);
    expect(lines.join("")).toContain("subscription.expired");
  });
});
