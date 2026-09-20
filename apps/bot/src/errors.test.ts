import { en } from "@launchbot/shared";
import { setLogDestination } from "@launchbot/shared/server";
import { Bot } from "grammy";
import { afterEach, describe, expect, it } from "vitest";
import type { BotContext } from "./context.js";
import { handleBotError } from "./errors.js";
import {
  callbackUpdate,
  feed,
  interceptApi,
  telegramError,
  TEST_ENV,
  textUpdate,
} from "./test-harness.js";
import type { ApiReplies } from "./test-harness.js";

/**
 * Captures what the logger really writes, formatting and scrubbing included: the modules bind
 * their logger at import time, so the destination is where a test can read them.
 */
function captureLogs() {
  const lines: string[] = [];
  setLogDestination({ write: (line) => void lines.push(line) });
  return lines;
}

afterEach(() => {
  setLogDestination(undefined);
});

/**
 * A bot whose only handler fails, so `bot.catch` is what the test observes. The real chain
 * ends with `ensureAnswered`, which is terminal: a failing middleware appended to it would
 * never run.
 */
const brokenBot = (failWith: Error, replies: ApiReplies = {}) => {
  const bot = new Bot<BotContext>(TEST_ENV.BOT_TOKEN);
  const api = interceptApi(bot, replies);
  bot.use(() => Promise.reject(failWith));
  bot.catch(handleBotError);
  return { bot, api };
};

describe("bot.catch", () => {
  it("tells the user something went wrong, with an alert on a click", async () => {
    const { bot, api } = brokenBot(new Error("boom"));

    await feed(bot, callbackUpdate("sup:open"));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: en.common.genericError,
      show_alert: true,
    });
  });

  it("answers a message with the generic error, never a stack", async () => {
    const { bot, api } = brokenBot(new Error("boom at /src/secret/path.ts:42"));

    await feed(bot, textUpdate("hello"));

    const sent = api.of("sendMessage")[0]?.payload;
    expect(sent?.["text"]).toBe(en.common.genericError);
    expect(JSON.stringify(sent)).not.toContain("secret/path");
  });

  it("never logs the bot token, even when the error carries it", async () => {
    const lines = captureLogs();
    const { bot } = brokenBot(
      new Error(`request to https://api.telegram.org/bot${TEST_ENV.BOT_TOKEN}/getMe failed`),
    );

    await feed(bot, textUpdate("hello"));

    const logged = lines.join("\n");
    expect(logged).toContain("Update failed");
    expect(logged).not.toContain(TEST_ENV.BOT_TOKEN);
  });

  it("logs the shape of a GrammyError but never its payload", async () => {
    const lines = captureLogs();
    const failure = telegramError("sendMessage", "Bad Request: chat not found");
    // grammY puts the text we sent, and so a user input, in the payload.
    (failure as { payload: Record<string, unknown> }).payload = {
      text: "my private key is 5Kb8kLf9...",
    };
    const { bot } = brokenBot(failure);

    await feed(bot, callbackUpdate("sup:open"));

    const logged = lines.join("\n");
    expect(logged).toContain("sendMessage");
    expect(logged).toContain("chat not found");
    expect(logged).not.toContain("private key");
  });

  it("logs the update shape and the user, never the message text", async () => {
    const lines = captureLogs();
    const { bot } = brokenBot(new Error("boom"));

    await feed(bot, textUpdate("paste of a seed phrase: abandon abandon ability"));

    const logged = lines.join("\n");
    expect(logged).toContain("123456789");
    expect(logged).not.toContain("abandon");
  });

  it("only logs a failure to reach the user", async () => {
    const lines = captureLogs();
    const { bot } = brokenBot(new Error("boom"), {
      sendMessage: telegramError("sendMessage", "Forbidden: bot was blocked by the user"),
    });

    await expect(feed(bot, textUpdate("hello"))).resolves.toBeUndefined();

    expect(lines.join("\n")).toContain("Could not tell the user about the error");
  });
});
