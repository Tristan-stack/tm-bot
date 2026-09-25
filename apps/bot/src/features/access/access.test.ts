import type { User } from "@launchbot/db";
import { createUi, en, encodeCallback, isCallbackDataSize, RATE_LIMITS } from "@launchbot/shared";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import { Bot, session } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialSession } from "../../context.js";
import type { BotContext } from "../../context.js";
import { createCallbackRouter } from "../../router/callback-router.js";
import {
  botHarness,
  callbackUpdate,
  chatMember,
  fakePrisma,
  feed,
  interceptApi,
  NEW_USER,
  telegramError,
  TEST_ENV,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import type { ApiReplies } from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { createAccess } from "./access.js";
import { joinedCallback } from "./screens.js";

const CHANNEL_TITLE = "<b>📢 ONE LAST STEP</b>";
const CHANNEL_SCREEN = `${CHANNEL_TITLE}\n\nJoin our channel to follow updates and new features.`;
const HOME_TITLE = "<b>🚀 LAUNCH BOT</b>";
const NOT_JOINED_LINE = "ℹ️ Not joined yet. Join the channel, then tap I've joined.";
const MEMBER_LIST_HIDDEN = telegramError(
  "getChatMember",
  "Bad Request: member list is inaccessible",
);

const harness = (user: Partial<User>, replies: ApiReplies = {}) => botHarness({ user, replies });

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
});

describe("access gate", () => {
  it("shows the channel screen, in a new message, to a new user", async () => {
    const { bot, api } = harness(NEW_USER);

    await feed(bot, textUpdate("/start"));

    expect(api.of("sendMessage")).toHaveLength(1);
    expect(api.text("sendMessage")).toBe(CHANNEL_SCREEN);
    expect(api.keyboard("sendMessage")).toEqual([
      [{ text: "📢 Join channel", url: "https://t.me/launchbot_channel" }],
      [{ text: "✅ I've joined", callback_data: "acc:join:home" }],
    ]);
    // Nothing is checked before "I've joined".
    expect(api.of("getChatMember")).toEqual([]);
  });

  it("shows it on any interaction, in place of the screen that was clicked", async () => {
    const { bot, api } = harness(NEW_USER);

    await feed(bot, callbackUpdate(MENU.refresh, { messageId: 55 }));

    // A click edits the screen that carries the button, and is answered without a text.
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(api.text("editMessageText")).toBe(CHANNEL_SCREEN);
    expect(api.of("answerCallbackQuery")).toHaveLength(1);
    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBeUndefined();
  });

  it("lets a user who is through reach the handlers", async () => {
    const { bot, api } = harness({});

    await feed(bot, callbackUpdate(MENU.refresh));

    expect(api.text("editMessageText")).toContain(HOME_TITLE);
  });

  it("always lets its own button through", async () => {
    const { bot, api } = harness(NEW_USER);

    await feed(bot, callbackUpdate(joinedCallback("home")));

    expect(api.of("getChatMember")).toHaveLength(1);
  });
});

describe("I've joined", () => {
  it("resumes home, in the same message, once the user is in the channel", async () => {
    const { bot, api, prisma } = harness(NEW_USER);

    await feed(bot, callbackUpdate(joinedCallback("home"), { messageId: 55 }));

    // Never from the cache, and with the numeric id of the user.
    expect(api.of("getChatMember")[0]?.payload).toEqual({
      chat_id: "-1001000000001",
      user_id: 123456789,
    });
    expect(prisma.currentUser().channelCheckedAt).toBeInstanceOf(Date);
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(api.text("editMessageText")).toContain(HOME_TITLE);
    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBeUndefined();
  });

  it("alerts and writes the line on the screen when the user has not joined", async () => {
    const { bot, api, prisma } = harness(
      { channelCheckedAt: new Date() },
      { getChatMember: chatMember("left") },
    );

    await feed(bot, callbackUpdate(joinedCallback("home")));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "You haven't joined the channel yet.",
      show_alert: true,
    });
    expect(api.text("editMessageText")).toBe(`${CHANNEL_SCREEN}\n\n${NOT_JOINED_LINE}`);
    expect(prisma.currentUser().channelCheckedAt).toBeNull();
  });

  it("keeps the launch note, above the line, and the resume target of the button", async () => {
    const { bot, api } = harness(NEW_USER, { getChatMember: chatMember("kicked") });

    await feed(bot, callbackUpdate(joinedCallback("launch")));

    expect(api.text("editMessageText")).toBe(
      [CHANNEL_SCREEN, "🚀 Join the channel to launch a coin.", NOT_JOINED_LINE].join("\n\n"),
    );
    expect(api.keyboard("editMessageText")[1]).toEqual([
      { text: "✅ I've joined", callback_data: "acc:join:launch" },
    ]);
  });

  it("settles for the alert when the line is already on the screen", async () => {
    const { bot, api } = harness(NEW_USER, {
      getChatMember: chatMember("left"),
      editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
    });

    await feed(bot, callbackUpdate(joinedCallback("home")));

    expect(api.of("answerCallbackQuery")).toHaveLength(1);
    expect(api.of("answerCallbackQuery")[0]?.payload["show_alert"]).toBe(true);
    expect(api.of("sendMessage")).toEqual([]);
  });

  it("refuses on a Telegram error: alert, line on the screen, date untouched, error logged", async () => {
    const lines = captureLogs();
    const checkedAt = new Date("2026-09-21T10:00:00Z");
    const { bot, api, prisma } = harness(
      { channelCheckedAt: checkedAt },
      { getChatMember: MEMBER_LIST_HIDDEN },
    );

    await feed(bot, callbackUpdate(joinedCallback("home")));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "We couldn't check your membership. Please try again in a moment.",
      show_alert: true,
    });
    expect(api.text("editMessageText")).toBe(
      `${CHANNEL_SCREEN}\n\n⚠️ We couldn't check your membership. Please try again in a moment.`,
    );
    expect(prisma.currentUser().channelCheckedAt).toBe(checkedAt);
    expect(lines.join("")).toContain("Channel membership check failed");
    expect(lines.join("")).not.toContain("123456789");
  });

  it("goes home for a resume target nobody registered", async () => {
    const { bot, api } = harness(NEW_USER);

    await feed(bot, callbackUpdate(encodeCallback("acc", "join", "gone")));

    expect(api.text("editMessageText")).toContain(HOME_TITLE);
  });

  it("stops calling Telegram past the rate limit, and says so on the screen", async () => {
    const { bot, api } = harness(NEW_USER, { getChatMember: chatMember("left") });
    const { limit } = RATE_LIMITS.channelCheck;

    for (let click = 0; click <= limit; click++) {
      await feed(bot, callbackUpdate(joinedCallback("home")));
    }

    expect(api.of("getChatMember")).toHaveLength(limit);
    expect(api.text("editMessageText", limit)).toMatch(
      /⏳ Too many actions\. Try again in \d+ s\./,
    );
    expect(api.of("answerCallbackQuery")[limit]?.payload["show_alert"]).toBe(true);
  });

  it("answers the expired-button text for an action it does not take", async () => {
    const { bot, api } = harness({});

    // "I accept" of a Terms screen sent before the Terms were removed (25/09/2026).
    await feed(bot, callbackUpdate(encodeCallback("acc", "terms")));

    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBe(en.common.staleButton);
  });
});

describe("/start", () => {
  it("opens home without calling Telegram while the last check is under 10 min old", async () => {
    const { bot, api } = harness({});

    await feed(bot, textUpdate("/start"));

    expect(api.of("getChatMember")).toEqual([]);
    expect(api.text("sendMessage")).toContain(HOME_TITLE);
  });

  it("shows the channel screen, in a new message, to a user who left the channel", async () => {
    const { bot, api, prisma } = harness(
      { channelCheckedAt: new Date("2026-09-20T10:00:00Z") },
      { getChatMember: chatMember("left") },
    );

    await feed(bot, textUpdate("/start"));

    expect(api.of("getChatMember")).toHaveLength(1);
    expect(api.of("sendMessage")).toHaveLength(1);
    expect(api.text("sendMessage")).toBe(CHANNEL_SCREEN);
    expect(prisma.currentUser().channelCheckedAt).toBeNull();
  });

  it("checks again after 10 min and opens home for a user who is still in the channel", async () => {
    const { bot, api } = harness({ channelCheckedAt: new Date("2026-09-20T10:00:00Z") });

    await feed(bot, textUpdate("/start"));

    expect(api.of("getChatMember")).toHaveLength(1);
    expect(api.text("sendMessage")).toContain(HOME_TITLE);
  });
});

describe("resume registry", () => {
  /** The access feature alone, as a flow of a later ticket plugs into it (V1-35). */
  function accessOnly() {
    const prisma = fakePrisma({ user: NEW_USER });
    const bot = new Bot<BotContext>(TEST_ENV.BOT_TOKEN);
    interceptApi(bot);
    const access = createAccess({ env: TEST_ENV, prisma, api: bot.api, ui: createUi("devnet") });
    const router = createCallbackRouter();
    access.register(router);

    bot.use(session({ initial: initialSession, getSessionKey: () => "test" }));
    bot.use((ctx, next) => {
      ctx.user = { ...TEST_USER, ...NEW_USER };
      return next();
    });
    bot.use(router.middleware());
    return { bot, access };
  }

  it("runs the resume target of the flow that was interrupted", async () => {
    const { bot, access } = accessOnly();
    const resumeLaunch = vi.fn<(ctx: BotContext) => Promise<void>>(() => Promise.resolve());
    access.registerResume("launch", resumeLaunch);

    await feed(bot, callbackUpdate(joinedCallback("launch")));

    expect(resumeLaunch).toHaveBeenCalledOnce();
    // What the check wrote is what the resumed flow reads.
    expect(resumeLaunch.mock.calls[0]?.[0].user.channelCheckedAt).toBeInstanceOf(Date);
  });

  it("refuses at startup a resume key that cannot go in a button", () => {
    const { access } = accessOnly();

    expect(() => access.registerResume("my launches", () => Promise.resolve())).toThrow();
  });

  it("keeps the callback data of the gate within 64 bytes", () => {
    for (const data of [joinedCallback("home"), joinedCallback("launch")]) {
      expect(isCallbackDataSize(data)).toBe(true);
    }
  });
});
