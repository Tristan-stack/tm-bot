import type { PrismaClient } from "@launchbot/db";
import { en, encodeCallback } from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENU } from "./features/home/screen.js";
import { createBotService } from "./index.js";
import { createCallbackRouter } from "./router/callback-router.js";
import {
  botHarness,
  callbackUpdate,
  feed,
  FIRST_MESSAGE_ID,
  channelPost,
  fakePrisma,
  storedSession,
  TEST_ENV,
  telegramError,
  textUpdate,
} from "./test-harness.js";
import type { ApiReplies } from "./test-harness.js";

const REFRESH = MENU.refresh;

const harness = (replies: ApiReplies = {}) => botHarness({ replies });

beforeEach(resetRateLimits);

describe("privateOnly", () => {
  it.each([
    ["a /start in a group", () => textUpdate("/start", { chat: { id: -100, type: "group" } })],
    [
      "a /start in a supergroup",
      () => textUpdate("/start", { chat: { id: -100, type: "supergroup" } }),
    ],
    ["a click in a group", () => callbackUpdate(REFRESH, { chat: { id: -100, type: "group" } })],
    ["a channel post", channelPost],
    ["a message from another bot", () => textUpdate("/start", { from: { is_bot: true } })],
  ])("performs no action on %s", async (_label, update) => {
    const { bot, api, prisma } = harness();

    await feed(bot, update());

    expect(api.calls).toEqual([]);
    expect(prisma.upserts).toEqual([]);
    expect(prisma.sessions.size).toBe(0);
  });
});

describe("/start", () => {
  it("sends a new screen in HTML with link previews disabled", async () => {
    const { bot, api, prisma } = harness();

    await feed(bot, textUpdate("/start"));

    const [sent, ...others] = api.of("sendMessage");
    expect(others).toEqual([]);
    expect(sent?.payload).toMatchObject({
      chat_id: 777,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    expect(sent?.payload["text"]).toContain("<b>🚀 LAUNCH BOT</b>");
    expect(sent?.payload["text"]).toContain("<code>123456789</code>");
    expect(api.of("editMessageText")).toEqual([]);
    expect(prisma.upserts).toHaveLength(1);
  });

  it("remembers the screen message so the next click edits it", async () => {
    const { bot, prisma } = harness();

    await feed(bot, textUpdate("/start"));

    expect(storedSession(prisma)).toEqual({ v: 1, screenMessageId: FIRST_MESSAGE_ID });
  });

  it("records the activity of every update", async () => {
    const { bot, prisma } = harness();

    await feed(bot, textUpdate("/start"));
    await feed(bot, callbackUpdate(REFRESH));

    expect(prisma.upserts).toHaveLength(2);
    expect(prisma.upserts[0]?.telegramId).toBe(123456789n);
    expect(prisma.upserts[1]?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
      prisma.upserts[0]?.lastActiveAt.getTime() ?? 0,
    );
  });
});

describe("showScreen on a click", () => {
  it("edits the message that carries the button", async () => {
    const { bot, api } = harness();

    await feed(bot, callbackUpdate(REFRESH, { messageId: 55 }));

    expect(api.of("sendMessage")).toEqual([]);
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({
      chat_id: 777,
      message_id: 55,
      parse_mode: "HTML",
    });
  });

  it("answers Already up to date when Telegram refuses an identical edit", async () => {
    const { bot, api } = harness({
      editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
    });

    await feed(bot, callbackUpdate(REFRESH));

    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBe(en.common.alreadyUpToDate);
    expect(api.of("sendMessage")).toEqual([]);
  });

  it("sends a new screen when the old one can no longer be edited", async () => {
    const { bot, api, prisma } = harness({
      editMessageText: telegramError("editMessageText", "Bad Request: message to edit not found"),
    });

    await feed(bot, callbackUpdate(REFRESH));

    expect(api.of("sendMessage")).toHaveLength(1);
    expect(storedSession(prisma)?.screenMessageId).toBeGreaterThan(0);
  });

  it("reports any other Telegram error to the user without leaking details", async () => {
    const { bot, api } = harness({
      editMessageText: telegramError("editMessageText", "Bad Request: chat not found"),
    });

    await feed(bot, callbackUpdate(REFRESH));

    const answer = api.of("answerCallbackQuery")[0]?.payload;
    expect(answer?.["text"]).toBe(en.common.genericError);
    expect(answer?.["show_alert"]).toBe(true);
  });
});

describe("callback router", () => {
  it.each([
    ["an unknown domain", "zzz:open"],
    ["data this codec never produced", "garbage"],
    ["an action the handler does not take", encodeCallback("home", "unknown")],
  ])("answers the expired-button text for %s", async (_label, data) => {
    const { bot, api } = harness();

    await feed(bot, callbackUpdate(data));

    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBe(en.common.staleButton);
    expect(api.of("editMessageText")).toEqual([]);
  });

  it("refuses two registrations of the same domain", () => {
    const router = createCallbackRouter();
    router.register("wal", { list: () => undefined });

    expect(() => router.register("wal", { list: () => undefined })).toThrow(/already registered/);
  });

  it("lets the ticket of a section replace its provisional screen, in either order", () => {
    const router = createCallbackRouter();
    router.registerProvisional("wal", () => undefined);

    expect(() => router.register("wal", { list: () => undefined })).not.toThrow();
    // Registered after the real one, a placeholder changes nothing.
    router.registerProvisional("wal", () => undefined);
    expect(() => router.register("wal", { list: () => undefined })).toThrow(/already registered/);
  });
});

describe("answering a callback query", () => {
  it("answers exactly once per click", async () => {
    const { bot, api } = harness();

    await feed(bot, callbackUpdate(REFRESH));

    expect(api.of("answerCallbackQuery")).toHaveLength(1);
  });

  it("closes the query even when the handler said nothing", async () => {
    const { bot, api } = harness();

    // "adm" has no handler yet: the router answers, and never leaves a click spinning.
    await feed(bot, callbackUpdate(encodeCallback("adm", "open")));

    expect(api.of("answerCallbackQuery")).toHaveLength(1);
  });
});

describe("global rate limit", () => {
  it("drops the 21st click of a 10 s window and says so", async () => {
    const { bot, api } = harness();

    for (let click = 0; click < 20; click++) await feed(bot, callbackUpdate(REFRESH));
    const before = api.calls.length;
    await feed(bot, callbackUpdate(REFRESH));

    const added = api.calls.slice(before);
    expect(added.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(added[0]?.payload["text"]).toBe(en.common.rateLimited);
  });

  it("drops an extra message without answering it", async () => {
    const { bot, api, prisma } = harness();

    for (let message = 0; message < 20; message++) await feed(bot, textUpdate("/start"));
    const before = api.calls.length;
    await feed(bot, textUpdate("/start"));

    expect(api.calls).toHaveLength(before);
    // The activity is still recorded: since V1-12 the limit runs after the session and the
    // upsert, so that a message holding a key is deleted even for a user over their limit.
    expect(prisma.upserts).toHaveLength(21);
  });
});

describe("createBotService", () => {
  it("never starts when the RPC is not devnet", async () => {
    const getGenesisHash = vi
      .fn()
      .mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    const service = createBotService({ env: TEST_ENV, prisma: fakePrisma(), getGenesisHash });

    await expect(service.start()).rejects.toThrow(/not a devnet RPC/);
    expect(getGenesisHash).toHaveBeenCalledOnce();
  });

  it("names the database when it cannot be reached, without its URL", async () => {
    const down = Object.assign(new Error("connect ECONNREFUSED postgresql://user:pw@host/db"), {
      code: "ECONNREFUSED",
    });
    const prisma = { ...fakePrisma(), $queryRaw: () => Promise.reject(down) } as PrismaClient;
    const getGenesisHash = vi
      .fn()
      .mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    const service = createBotService({ env: TEST_ENV, prisma, getGenesisHash });

    const start = service.start();

    await expect(start).rejects.toThrow("cannot reach the database of DATABASE_URL (ECONNREFUSED)");
    await expect(start).rejects.not.toThrow("user:pw");
  });

  it("does nothing until it is started: building the service has no side effect", () => {
    const getGenesisHash = vi.fn();

    createBotService({ env: TEST_ENV, prisma: fakePrisma(), getGenesisHash });

    expect(getGenesisHash).not.toHaveBeenCalled();
  });
});
