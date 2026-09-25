import type { GrantConfirmation, GrantPreview, User } from "@launchbot/db";
import {
  computeActivation,
  createUi,
  DAY_MS,
  getOffer,
  HOUR_MS,
  MINUTE_MS,
} from "@launchbot/shared";
import type { Offer, PlanStatus, SubscriptionPeriod } from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { GrammyError } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  botHarness,
  buttonTexts,
  callbackUpdate,
  feed,
  storedSession,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import type { ApiReplies } from "../../test-harness.js";
import type { AdminServices } from "./admin.js";
import { argWords } from "./common.js";
import {
  buildGrantConfirmScreen,
  buildGrantResultScreen,
  grantArgsSchema,
} from "./grant-screens.js";

const ui = createUi("devnet");
const NOW = new Date("2026-09-15T14:32:00Z");
const PREMIUM_1M = getOffer("PREMIUM", "ONE_MONTH");
const PREMIUM_2D = getOffer("PREMIUM", "TWO_DAYS");
const CLASSIC_2D = getOffer("CLASSIC", "TWO_DAYS");
const TARGET: User = {
  ...TEST_USER,
  id: "cjld2cjxh0000qzrmn831target",
  telegramId: 555_000_111n,
  username: "alice",
  firstName: "Alice",
};

beforeEach(resetRateLimits);

const period = (plan: "CLASSIC" | "PREMIUM", expiresAt: Date): SubscriptionPeriod => ({
  plan,
  duration: "ONE_MONTH",
  startsAt: new Date(NOW.getTime() - 10 * DAY_MS),
  expiresAt,
});

/** What `previewGrant` of V1-27 says, from the plan of now. */
function preview(offer: Offer, active: SubscriptionPeriod | null, now = NOW): GrantPreview {
  const status: PlanStatus =
    active === null ? { kind: "NONE" } : { kind: "ACTIVE", subscription: active };
  return { status, computed: computeActivation(active, offer, now, "GRANT") };
}

const confirmScreen = (offer: Offer, active: SubscriptionPeriod | null) =>
  buildGrantConfirmScreen(ui, {
    user: TARGET,
    offer,
    preview: preview(offer, active),
    now: NOW,
    nonce: "AbCd1234",
  });

describe("grantArgsSchema (V1-42)", () => {
  /** The text after `/grant`, or `null` for anything else (an @username, a word missing). */
  const parseGrantArgs = (text: string) => {
    const parsed = grantArgsSchema.safeParse(argWords(text));
    return parsed.success ? parsed.data : null;
  };

  it.each([
    ["123456789 premium 1m", "123456789", "P1M"],
    ["P-123456789 Premium 2d", "P-123456789", "P2D"],
    ["c-123456789 CLASSIC 1M", "c-123456789", "C1M"],
  ])("reads %j", (text, query, code) => {
    expect(parseGrantArgs(text)).toMatchObject({
      query,
      ref: { telegramId: 123_456_789n },
      offer: { code },
    });
  });

  it.each([
    "@user premium 1m",
    "123 gold 1m",
    "123 premium 3d",
    "123 premium",
    "123 premium 1m x",
    "-5 premium 1m",
    "",
  ])("refuses %j", (text) => {
    expect(parseGrantArgs(text)).toBeNull();
  });
});

describe("buildGrantConfirmScreen (V1-42)", () => {
  it("NEW: the question, the current plan, the end, Confirm and Cancel", () => {
    const screen = confirmScreen(PREMIUM_2D, null);

    expect(screen.text).toBe(
      [
        "<b>⭐ GRANT</b> · 🧪 Devnet",
        "",
        "Grant Premium · 2 days to @alice (ID <code>555000111</code>)?",
        "",
        "Current plan: None",
        "Ends: 17 Sep 2026, 14:32 UTC",
      ].join("\n"),
    );
    expect(buttonTexts(screen.reply_markup)).toEqual([["✅ Confirm", "❌ Cancel"]]);
    expect(
      screen.reply_markup.inline_keyboard[0]?.map(
        (button) => "callback_data" in button && button.callback_data,
      ),
    ).toEqual(["adm:grant:ok:AbCd1234", "adm:grant:no:AbCd1234"]);
  });

  it("NEW for a month ends 30 days later", () => {
    expect(confirmScreen(PREMIUM_1M, null).text).toContain("Ends: 15 Oct 2026, 14:32 UTC");
  });

  it("EXTEND builds on the current end and says so", () => {
    const text = confirmScreen(
      PREMIUM_1M,
      period("PREMIUM", new Date("2026-09-16T18:32:00Z")),
    ).text;

    expect(text).toContain("Current plan: Premium · 1d 4h left");
    expect(text).toContain("Ends: 16 Oct 2026, 18:32 UTC");
    expect(text).toContain("ℹ️ Extends the current Premium by 1 month.");
  });

  it("UPGRADE warns that the Classic time is lost", () => {
    const text = confirmScreen(
      PREMIUM_1M,
      period("CLASSIC", new Date("2026-10-12T14:32:00Z")),
    ).text;

    expect(text).toContain("Current plan: Classic · until 12 Oct");
    expect(text).toContain("Ends: 15 Oct 2026, 14:32 UTC");
    expect(text).toContain("⚠️ Their remaining Classic time will be lost.");
  });

  it("REFUSED: Classic during Premium, no end, Cancel only", () => {
    const screen = confirmScreen(CLASSIC_2D, period("PREMIUM", new Date("2026-10-12T14:32:00Z")));

    expect(screen.text).toBe(
      [
        "<b>⭐ GRANT</b> · 🧪 Devnet",
        "",
        "Grant Classic · 2 days to @alice (ID <code>555000111</code>)?",
        "",
        "Current plan: Premium · until 12 Oct",
        "",
        "⚠️ Classic: available when their Premium ends (12 Oct 2026, 14:32 UTC).",
      ].join("\n"),
    );
    expect(buttonTexts(screen.reply_markup)).toEqual([["❌ Cancel"]]);
  });

  it("names a user without a username by the first name, escaped", () => {
    const screen = buildGrantConfirmScreen(ui, {
      user: { ...TARGET, username: null, firstName: "Bob <3" },
      offer: PREMIUM_2D,
      preview: preview(PREMIUM_2D, null),
      now: NOW,
      nonce: "AbCd1234",
    });

    expect(screen.text).toContain("to Bob &lt;3 (ID <code>555000111</code>)?");
  });
});

describe("buildGrantResultScreen (V1-42)", () => {
  it("says the real end, without a keyboard", () => {
    const expiresAt = new Date("2026-10-15T14:32:00Z");

    const screen = buildGrantResultScreen(ui, {
      user: TARGET,
      offer: PREMIUM_1M,
      expiresAt,
      notified: true,
    });

    expect(screen.text).toBe(
      [
        "<b>⭐ GRANT</b> · 🧪 Devnet",
        "",
        "✅ Premium active until 15 Oct 2026, 14:32 UTC.",
        "Granted to @alice (ID <code>555000111</code>) · Premium · 1 month",
      ].join("\n"),
    );
    expect(screen.reply_markup.inline_keyboard).toEqual([]);
    expect(
      buildGrantResultScreen(ui, { user: TARGET, offer: PREMIUM_1M, expiresAt, notified: false })
        .text,
    ).toContain("ℹ️ The user could not be notified.");
  });
});

describe("/grant (V1-42)", () => {
  const PLAN_END = new Date(Date.now() + 30 * DAY_MS);

  function harness(
    options: { confirm?: GrantConfirmation[]; replies?: ApiReplies; used?: boolean } = {},
  ) {
    const results = [...(options.confirm ?? [])];
    const subscriptions: AdminServices["subscriptions"] = {
      previewGrant: vi.fn((_userId: string, offer: Offer, now: Date) =>
        Promise.resolve(preview(offer, null, now)),
      ),
      confirmGrant: vi.fn(() =>
        Promise.resolve(
          results.shift() ?? {
            status: "ACTIVATED" as const,
            kind: "NEW" as const,
            subscription: {
              id: "sub1",
              plan: "PREMIUM" as const,
              duration: "ONE_MONTH" as const,
              startsAt: new Date(),
              expiresAt: PLAN_END,
            },
          },
        ),
      ),
      isGrantUsed: vi.fn(() => Promise.resolve(options.used ?? false)),
    };
    const h = botHarness({
      env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID] },
      replies: options.replies,
      admin: {
        subscriptions,
        support: {
          findUser: (telegramId) =>
            Promise.resolve(telegramId === TARGET.telegramId ? TARGET : null),
          findUserById: (id) => Promise.resolve(id === TARGET.id ? TARGET : null),
          loadUserSupportData: () => Promise.reject(new Error("unused")),
          inactivitySweeps: () => Promise.resolve([]),
          walletSecrets: () => Promise.resolve([]),
        },
      },
    });
    const confirmData = () => {
      const button = h.api.keyboard("sendMessage", -1)[0]?.[0];
      return button !== undefined && "callback_data" in button ? button.callback_data : "";
    };
    return { ...h, subscriptions, confirmData };
  }

  it("confirms, activates through V1-27, tells the user, then shows the result", async () => {
    const h = harness();

    await feed(h.bot, textUpdate(`/grant P-${TARGET.telegramId} premium 1m`));
    const state = storedSession(h.prisma)?.adminGrant;
    expect(state).toMatchObject({
      targetUserId: TARGET.id,
      targetTelegramId: "555000111",
      offerCode: "P1M",
      kind: "NEW",
      currentExpiresAt: null,
    });
    expect(h.api.text("sendMessage")).toContain("Grant Premium · 1 month to @alice");
    expect(h.confirmData()).toBe(`adm:grant:ok:${state?.nonce}`);

    await feed(h.bot, callbackUpdate(h.confirmData(), { messageId: 60 }));

    expect(h.subscriptions.confirmGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TARGET.id,
        offer: PREMIUM_1M,
        actorTelegramId: TEST_USER.telegramId,
        nonce: state?.nonce,
        expected: { kind: "NEW", currentExpiresAt: null },
      }),
    );
    // The user first, then the admin's screen, which says whether the user heard it.
    const notice = h.api.of("sendMessage").at(-1);
    expect(notice?.payload).toMatchObject({ chat_id: "555000111" });
    expect(String(notice?.payload["text"])).toContain("⭐ Premium is active until");
    expect(h.api.screen()).toContain("✅ Premium active until");
    expect(h.api.screen()).not.toContain("could not be notified");
    expect(h.api.keyboard("editMessageText", -1)).toEqual([]);
    expect(storedSession(h.prisma)?.adminGrant).toBeUndefined();
  });

  it("says so when the user could not be told", async () => {
    const replies: ApiReplies = {};
    const h = harness({ replies });
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} premium 1m`));
    // The user blocked the bot: the send to their chat fails, the grant stays.
    replies["sendMessage"] = new GrammyError(
      "Call to 'sendMessage' failed!",
      { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
      "sendMessage",
      {},
    );

    await feed(h.bot, callbackUpdate(h.confirmData()));

    expect(h.subscriptions.confirmGrant).toHaveBeenCalledOnce();
    expect(h.api.screen()).toContain("✅ Premium active until");
    expect(h.api.screen()).toContain("ℹ️ The user could not be notified.");
  });

  it("a Confirm already used writes nothing", async () => {
    const h = harness({ used: true });
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} premium 1m`));

    await feed(h.bot, callbackUpdate(h.confirmData()));

    expect(h.subscriptions.confirmGrant).not.toHaveBeenCalled();
    expect(h.api.lastAlert()).toMatchObject({
      text: "This grant is no longer valid.",
      show_alert: true,
    });
  });

  it("a confirmation older than 10 minutes, or of another screen, expires", async () => {
    const h = harness();
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} premium 1m`));
    const data = h.confirmData();
    const session = storedSession(h.prisma);
    h.prisma.sessions.set(
      "777",
      JSON.stringify({
        ...session,
        adminGrant: { ...session?.adminGrant, createdAt: Date.now() - 10 * MINUTE_MS - 1 },
      }),
    );

    await feed(h.bot, callbackUpdate(data));
    await feed(h.bot, callbackUpdate("adm:grant:ok:ZzZz9999"));

    expect(h.subscriptions.confirmGrant).not.toHaveBeenCalled();
    expect(h.api.of("answerCallbackQuery").map((call) => call.payload["text"])).toEqual([
      "This grant has expired. Send /grant again.",
      "This grant has expired. Send /grant again.",
    ]);
    expect(h.api.screen()).toContain("⌛ This grant has expired. Send /grant again.");
    expect(h.api.keyboard("editMessageText", -1)).toEqual([]);
    expect(storedSession(h.prisma)?.adminGrant).toBeUndefined();
  });

  it("a plan changed since the screen activates nothing and shows the plan of now", async () => {
    const h = harness({ confirm: [{ status: "CHANGED" }] });
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} premium 1m`));
    const first = h.confirmData();

    await feed(h.bot, callbackUpdate(first, { messageId: 60 }));

    expect(h.api.lastAlert()).toMatchObject({
      text: "The user's plan changed. Check again.",
      show_alert: true,
    });
    expect(h.subscriptions.previewGrant).toHaveBeenCalledTimes(2);
    const again = h.api.keyboard("editMessageText", -1)[0]?.[0];
    expect(again !== undefined && "callback_data" in again && again.callback_data).not.toBe(first);
    expect(h.api.screen()).toContain("Grant Premium · 1 month to @alice");
  });

  it("Cancel writes nothing and says so, without a keyboard", async () => {
    const h = harness();
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} classic 2d`));
    const cancel = h.api.keyboard("sendMessage", -1)[0]?.[1];

    await feed(
      h.bot,
      callbackUpdate(cancel !== undefined && "callback_data" in cancel ? cancel.callback_data : ""),
    );

    expect(h.subscriptions.confirmGrant).not.toHaveBeenCalled();
    expect(h.api.screen()).toContain("❌ Grant canceled.");
    expect(h.api.keyboard("editMessageText", -1)).toEqual([]);
    expect(storedSession(h.prisma)?.adminGrant).toBeUndefined();
  });

  it("an unknown account is « User not found. »", async () => {
    const h = harness();

    await feed(h.bot, textUpdate("/grant 123 premium 2d"));

    expect(h.api.text("sendMessage")).toContain("❌ User not found.\nSearched: 123");
    expect(h.subscriptions.previewGrant).not.toHaveBeenCalled();
  });

  it("the extension a screen showed travels with its Confirm", async () => {
    const h = harness();
    const end = new Date(Date.now() + 2 * HOUR_MS);
    vi.mocked(h.subscriptions.previewGrant).mockImplementation((_userId, offer, now) =>
      Promise.resolve(preview(offer, period("PREMIUM", end), now)),
    );
    await feed(h.bot, textUpdate(`/grant ${TARGET.telegramId} premium 2d`));

    await feed(h.bot, callbackUpdate(h.confirmData()));

    expect(h.subscriptions.confirmGrant).toHaveBeenCalledWith(
      expect.objectContaining({ expected: { kind: "EXTEND", currentExpiresAt: end } }),
    );
  });
});
