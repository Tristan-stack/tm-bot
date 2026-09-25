import { cbBtn, en, encodeCallback, renderScreen, TG } from "@launchbot/shared";
import type { Screen } from "@launchbot/shared";
import { Bot, session } from "grammy";
import { describe, expect, it } from "vitest";
import { initialSession } from "./context.js";
import type { BotContext } from "./context.js";
import { ensureAnswered, notify } from "./navigation/notify.js";
import { blockWithFlag, showScreen } from "./navigation/show-screen.js";
import type { ShowResult } from "./navigation/show-screen.js";
import {
  callbackUpdate,
  feed,
  FIRST_MESSAGE_ID,
  interceptApi,
  telegramError,
  TEST_ENV,
  TEST_USER,
  textUpdate,
} from "./test-harness.js";
import type { ApiReplies } from "./test-harness.js";

const screen = (text = "Body"): Screen =>
  renderScreen({
    header: "<b>👛 WALLETS</b>",
    description: text,
    keyboard: [[cbBtn(en.btn.refresh, encodeCallback("home", "refresh"))]],
  });

/**
 * A bot reduced to what the navigation needs: an in-memory session and one middleware under
 * test. It avoids the full chain, whose router answers every callback before a test can.
 */
function minimalBot(
  handler: (ctx: BotContext) => Promise<unknown>,
  replies: ApiReplies = {},
  initial = initialSession(),
) {
  const bot = new Bot<BotContext>(TEST_ENV.BOT_TOKEN);
  // The screens of these tests are placeholders: the rules of §4.5 are the other tests' job.
  const api = interceptApi(bot, replies, { screens: false });
  const results: ShowResult[] = [];

  bot.use(ensureAnswered);
  bot.use(session({ initial: () => initial, getSessionKey: () => "test" }));
  bot.use(async (ctx) => {
    ctx.user = TEST_USER;
    const result = await handler(ctx);
    if (result !== undefined) results.push(result as ShowResult);
  });

  return { bot, api, results, session: initial };
}

describe("showScreen", () => {
  it("edits the message that carries the button on a click", async () => {
    const { bot, api, results, session: state } = minimalBot((ctx) => showScreen(ctx, screen()));

    await feed(bot, callbackUpdate("home:refresh", { messageId: 42 }));

    expect(results[0]).toEqual({ status: "edited", messageId: 42 });
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 42 });
    expect(state.screenMessageId).toBe(42);
  });

  it("returns not_modified instead of throwing on an identical edit", async () => {
    const { bot, api, results } = minimalBot((ctx) => showScreen(ctx, screen()), {
      editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
    });

    await feed(bot, callbackUpdate("home:refresh", { messageId: 42 }));

    expect(results[0]?.status).toBe("not_modified");
    expect(api.of("sendMessage")).toEqual([]);
  });

  it.each([
    "Bad Request: message to edit not found",
    "Bad Request: message can't be edited",
    "Bad Request: there is no text in the message to edit",
  ])("falls back to a new message on %j", async (description) => {
    const {
      bot,
      api,
      results,
      session: state,
    } = minimalBot((ctx) => showScreen(ctx, screen()), {
      editMessageText: telegramError("editMessageText", description),
    });

    await feed(bot, callbackUpdate("home:refresh"));

    expect(results[0]).toEqual({ status: "sent_new", messageId: FIRST_MESSAGE_ID });
    expect(api.of("sendMessage")).toHaveLength(1);
    expect(state.screenMessageId).toBe(FIRST_MESSAGE_ID);
  });

  it("lets any other Telegram error through", async () => {
    const { bot } = minimalBot((ctx) => showScreen(ctx, screen()), {
      editMessageText: telegramError("editMessageText", "Bad Request: chat not found"),
    });

    await expect(feed(bot, callbackUpdate("home:refresh"))).rejects.toThrow(/chat not found/);
  });

  it("always sends a new message in mode new", async () => {
    const { bot, api, results } = minimalBot(
      (ctx) => showScreen(ctx, screen(), { mode: "new" }),
      {},
      { v: 1, screenMessageId: 42 },
    );

    await feed(bot, textUpdate("/start"));

    expect(results[0]?.status).toBe("sent");
    expect(api.of("editMessageText")).toEqual([]);
    expect(api.of("sendMessage")).toHaveLength(1);
  });

  it("after a user input, sends a new screen and unarms the old keyboard", async () => {
    const { bot, api, results } = minimalBot(
      (ctx) => showScreen(ctx, screen()),
      {},
      { v: 1, screenMessageId: 42 },
    );

    await feed(bot, textUpdate("Moon Otter"));

    expect(results[0]?.status).toBe("sent");
    expect(api.of("editMessageReplyMarkup")[0]?.payload).toMatchObject({ message_id: 42 });
    expect(api.of("sendMessage")).toHaveLength(1);
  });

  it("ignores a failure to unarm the old keyboard", async () => {
    const { bot, api } = minimalBot(
      (ctx) => showScreen(ctx, screen()),
      {
        editMessageReplyMarkup: telegramError(
          "editMessageReplyMarkup",
          "Bad Request: message to edit not found",
        ),
      },
      { v: 1, screenMessageId: 42 },
    );

    await feed(bot, textUpdate("Moon Otter"));

    expect(api.of("sendMessage")).toHaveLength(1);
  });
});

describe("blockWithFlag", () => {
  it("shows the alert and writes the flag on the screen (§4.5)", async () => {
    const { bot, api } = minimalBot((ctx) =>
      blockWithFlag(
        ctx,
        { alert: "Add a name and ticker first.", flag: "⚠️ Missing: name, ticker" },
        screen,
      ),
    );

    await feed(bot, callbackUpdate("home:refresh"));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Add a name and ticker first.",
      show_alert: true,
    });
    expect(api.of("editMessageText")[0]?.payload["text"]).toContain("⚠️ Missing: name, ticker");
  });

  it("does not fail when the flag is already on the screen", async () => {
    const { bot, api } = minimalBot(
      (ctx) => blockWithFlag(ctx, { alert: "Blocked.", flag: "⚠️ Flag" }, screen),
      { editMessageText: telegramError("editMessageText", "Bad Request: message is not modified") },
    );

    await feed(bot, callbackUpdate("home:refresh"));

    expect(api.of("answerCallbackQuery")).toHaveLength(1);
  });
});

describe("notify", () => {
  it("answers once, ignoring later calls", async () => {
    const { bot, api } = minimalBot(async (ctx) => {
      await notify(ctx, "First");
      await notify(ctx, "Second", { alert: true });
      return undefined;
    });

    await feed(bot, callbackUpdate("home:refresh"));

    expect(api.of("answerCallbackQuery")).toHaveLength(1);
    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBe("First");
  });

  it("truncates to the 200 characters Telegram accepts", async () => {
    const { bot, api } = minimalBot((ctx) => notify(ctx, "x".repeat(250)));

    await feed(bot, callbackUpdate("home:refresh"));

    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toHaveLength(
      TG.CALLBACK_ALERT_MAX_CHARS,
    );
  });

  it("does nothing outside a callback query", async () => {
    const { bot, api } = minimalBot((ctx) => notify(ctx, "Nothing to answer"));

    await feed(bot, textUpdate("hello"));

    expect(api.calls).toEqual([]);
  });

  it("ignores a query that is too old to answer", async () => {
    const { bot } = minimalBot((ctx) => notify(ctx, "Too late"), {
      answerCallbackQuery: telegramError(
        "answerCallbackQuery",
        "Bad Request: query is too old and response timeout expired or query ID is invalid",
      ),
    });

    await expect(feed(bot, callbackUpdate("home:refresh"))).resolves.toBeUndefined();
  });

  it("lets another answerCallbackQuery error through", async () => {
    const { bot } = minimalBot((ctx) => notify(ctx, "Boom"), {
      answerCallbackQuery: telegramError("answerCallbackQuery", "Bad Request: chat not found"),
    });

    await expect(feed(bot, callbackUpdate("home:refresh"))).rejects.toThrow(/chat not found/);
  });
});

describe("ensureAnswered", () => {
  it("closes a query nobody answered, so the client stops spinning", async () => {
    const { bot, api } = minimalBot(() => Promise.resolve(undefined));

    await feed(bot, callbackUpdate("home:refresh"));

    // No text: the answer only closes the query.
    expect(Object.keys(api.of("answerCallbackQuery")[0]?.payload ?? {})).toEqual([
      "callback_query_id",
    ]);
  });
});
