import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import type { ChatMember } from "grammy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatMember, telegramError, TEST_ENV } from "../../test-harness.js";
import { checkChannelRights } from "./startup-check.js";

const BOT_ID = 424242;
const ADMIN = chatMember("administrator", { can_post_messages: true });

/** Replies by channel id; a channel that is not listed answers as a full administrator. */
function run(replies: Record<string, ChatMember | Error>) {
  const lines = captureLogs();
  const getChatMember = vi.fn((channelId: string | number) => {
    const reply = replies[String(channelId)] ?? ADMIN;
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  return { lines, getChatMember, done: checkChannelRights({ getChatMember }, BOT_ID, TEST_ENV) };
}

afterEach(() => {
  setLogDestination(undefined);
});

describe("checkChannelRights", () => {
  it("asks for the rights of the bot itself in the three channels, and logs nothing when fine", async () => {
    const { lines, getChatMember, done } = run({
      [TEST_ENV.CHANNEL_SUCCESS_ID]: chatMember("creator"),
    });

    await done;

    expect(getChatMember.mock.calls).toEqual([
      [TEST_ENV.CHANNEL_BOT_ID, BOT_ID],
      [TEST_ENV.CHANNEL_SUCCESS_ID, BOT_ID],
      [TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID, BOT_ID],
    ]);
    expect(lines).toEqual([]);
  });

  it("names the variable of a channel the bot does not administer", async () => {
    const { lines, done } = run({ [TEST_ENV.CHANNEL_SUCCESS_ID]: chatMember("member") });

    await done;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":50');
    expect(lines[0]).toContain(
      `Bot is not an administrator of CHANNEL_SUCCESS_ID (${TEST_ENV.CHANNEL_SUCCESS_ID}): membership checks and posts will fail.`,
    );
  });

  it("reports an administrator that cannot post", async () => {
    const { lines, done } = run({
      [TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID]: chatMember("administrator", {
        can_post_messages: false,
      }),
    });

    await done;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Bot cannot post messages in CHANNEL_ANNOUNCEMENTS_ID");
  });

  it("reports a channel Telegram refuses to answer for, without stopping the bot", async () => {
    const { lines, done } = run({
      [TEST_ENV.CHANNEL_BOT_ID]: telegramError("getChatMember", "Bad Request: chat not found"),
    });

    await expect(done).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Could not check the rights of the bot in CHANNEL_BOT_ID");
    expect(lines[0]).toContain("chat not found");
  });
});
