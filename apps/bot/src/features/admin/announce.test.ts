import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import type { MessageEntity } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_VERSION } from "../../context.js";
import type { AnnounceState } from "../../context.js";
import {
  ADMIN_ID,
  botHarness,
  buttonTexts,
  callbackUpdate,
  feed,
  FIRST_MESSAGE_ID,
  messageUpdate,
  storedSession,
  TEST_ENV,
  textUpdate,
} from "../../test-harness.js";

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
});

const CHAT_ID = 777;
const BOLD: MessageEntity[] = [{ type: "bold", offset: 0, length: 3 }];

const INPUT_SCREEN = [
  "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
  "",
  "Send the announcement (text or photo with caption).",
  "",
  "Formatting and links are kept as sent.",
  "Text: 4096 characters max · Caption: 1024 characters max",
  "Default channel: Announcements",
].join("\n");

const previewScreen = (type: string, channels: [string, string]) =>
  [
    "<b>📣 ANNOUNCE · PREVIEW</b> · 🧪 Devnet",
    "",
    "Check the preview above, choose the channels, then tap Publish.",
    "",
    type,
    "Channels:",
    ...channels,
  ].join("\n");

const PUBLISHED = [
  "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
  "",
  "✅ Published.",
  "",
  "📣 Announcements · ✅",
  "📢 Bot channel · ✅",
].join("\n");

/** The user of the tests as an admin. */
const harness = () => botHarness({ env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID] } });
type Harness = ReturnType<typeof harness>;

const draftOf = (h: Harness) => storedSession(h.prisma)?.announce;
const draftId = (h: Harness) => draftOf(h)?.id ?? "";

/** The posts in a channel: the `sendMessage` or `sendPhoto` calls with its id. */
const postsIn = (h: Harness, chatId: string) =>
  h.api.calls.filter(
    (call) =>
      (call.method === "sendMessage" || call.method === "sendPhoto") &&
      call.payload["chat_id"] === chatId,
  );

/** /announce, then a text with bold: the preview and its control screen. */
async function openPreview(h: Harness, text = "Big news") {
  await feed(h.bot, textUpdate("/announce"));
  await feed(h.bot, messageUpdate({ text, entities: BOLD }));
}

/**
 * Makes the posts in a channel fail with this answer of Telegram while `failing.on`: the call is
 * still recorded by the harness first.
 */
function failPostsIn(h: Harness, chatId: string, errorCode: number, description: string) {
  const failing = { on: true };
  h.bot.api.config.use(async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal);
    const post = method === "sendMessage" || method === "sendPhoto";
    if (!failing.on || !post || (payload as { chat_id?: unknown }).chat_id !== chatId) {
      return result;
    }
    return { ok: false, error_code: errorCode, description } as unknown as typeof result;
  });
  return failing;
}

describe("/announce: the input (V1-38)", () => {
  it("opens the input as a new message, Announcements ticked by default", async () => {
    const h = harness();

    await feed(h.bot, textUpdate("/announce"));

    expect(h.api.text("sendMessage")).toBe(INPUT_SCREEN);
    expect(h.api.keyboard("sendMessage")).toEqual([
      [{ text: "❌ Cancel", callback_data: `adm:ann:cancel:${draftId(h)}` }],
    ]);
    expect(storedSession(h.prisma)).toMatchObject({
      pendingInput: { kind: "announce" },
      announce: {
        status: "AWAITING_INPUT",
        targets: { announcements: true, botChannel: false },
        results: {},
      },
    });
    expect(draftId(h)).toMatch(/^[\w-]{8}$/);
  });

  it("takes no argument: /announce with a text is the syntax reminder", async () => {
    const h = harness();

    await feed(h.bot, textUpdate("/announce Big news"));

    expect(h.api.text("sendMessage")).toBe(
      [
        "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
        "",
        "❌ Invalid command.",
        "Usage: /announce",
        "Example: /announce, then send the message to publish.",
      ].join("\n"),
    );
    expect(draftOf(h)).toBeUndefined();
  });

  it("sends the preview as the post will be, then the control screen; the message stays", async () => {
    const h = harness();

    await openPreview(h);

    const [, preview, control] = h.api.of("sendMessage");
    // The preview: the text and its entities as sent, no parse_mode, no keyboard.
    expect(preview?.payload).toEqual({ chat_id: CHAT_ID, text: "Big news", entities: BOLD });
    expect(control?.payload["text"]).toBe(
      previewScreen("Type: text · 8/4096 characters", ["☑️ Announcements", "⬜ Bot channel"]),
    );
    expect(buttonTexts(control?.payload["reply_markup"] as never)).toEqual([
      ["☑️ Announcements", "⬜ Bot channel"],
      ["📣 Publish"],
      ["✏️ Edit", "❌ Cancel"],
    ]);
    // The input above loses its Cancel; the message of the admin is not deleted.
    expect(h.api.of("editMessageReplyMarkup")[0]?.payload["message_id"]).toBe(FIRST_MESSAGE_ID);
    expect(h.api.of("deleteMessage")).toEqual([]);
    expect(draftOf(h)).toMatchObject({
      status: "PREVIEW",
      content: { kind: "text", text: "Big news", entities: BOLD },
      previewMessageId: FIRST_MESSAGE_ID + 1,
    });
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();
  });

  it("does not take an announcement with a Solana address for a key", async () => {
    const h = harness();
    const text = "Airdrop to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU today.";

    await feed(h.bot, textUpdate("/announce"));
    await feed(h.bot, messageUpdate({ text }));

    expect(h.api.text("sendMessage", 1)).toBe(text);
    expect(h.api.of("deleteMessage")).toEqual([]);
  });

  it("sends a photo by the file_id of its biggest size, with its caption", async () => {
    const h = harness();
    const captionEntities: MessageEntity[] = [{ type: "italic", offset: 4, length: 4 }];

    await feed(h.bot, textUpdate("/announce"));
    await feed(
      h.bot,
      messageUpdate({
        photo: [
          { file_id: "small", file_unique_id: "s", width: 90, height: 60 },
          { file_id: "big", file_unique_id: "b", width: 1280, height: 853 },
        ],
        caption: "New look",
        caption_entities: captionEntities,
      }),
    );

    expect(h.api.of("sendPhoto")[0]?.payload).toEqual({
      chat_id: CHAT_ID,
      photo: "big",
      caption: "New look",
      caption_entities: captionEntities,
    });
    expect(h.api.text("sendMessage", -1)).toBe(
      previewScreen("Type: photo with caption · 8/1024 characters", [
        "☑️ Announcements",
        "⬜ Bot channel",
      ]),
    );
  });

  it.each([
    [
      "a video",
      { video: { file_id: "v", file_unique_id: "v", width: 1, height: 1, duration: 3 } },
      "⚠️ Unsupported message. Send text or a photo with a caption.",
    ],
    [
      "a photo without a caption",
      { photo: [{ file_id: "p", file_unique_id: "p", width: 90, height: 60 }] },
      "⚠️ Add a caption to the photo.",
    ],
    [
      "a caption too long",
      {
        photo: [{ file_id: "p", file_unique_id: "p", width: 90, height: 60 }],
        caption: "a".repeat(1350),
      },
      "⚠️ Caption too long: 1,350/1024 characters.",
    ],
  ])("refuses %s: the input again under it, with the flag", async (_case, fields, flag) => {
    const h = harness();

    await feed(h.bot, textUpdate("/announce"));
    await feed(h.bot, messageUpdate(fields));

    expect(h.api.of("sendPhoto")).toEqual([]);
    expect(h.api.of("sendMessage")).toHaveLength(2);
    expect(h.api.text("sendMessage", 1)).toBe(`${INPUT_SCREEN}\n\n${flag}`);
    expect(h.api.of("editMessageReplyMarkup")[0]?.payload["message_id"]).toBe(FIRST_MESSAGE_ID);
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "announce" });
    expect(draftOf(h)?.status).toBe("AWAITING_INPUT");
  });

  it("stops waiting when another command comes: its next text is not an announcement", async () => {
    const h = harness();

    await feed(h.bot, textUpdate("/announce"));
    await feed(h.bot, textUpdate("/start"));
    await feed(h.bot, messageUpdate({ text: "Big news" }));

    expect(h.api.calls.some((call) => call.payload["text"] === "Big news")).toBe(false);
  });

  it("says so when Telegram refuses the preview, and keeps waiting", async () => {
    const h = harness();
    await feed(h.bot, textUpdate("/announce"));
    h.bot.api.config.use((prev, method, payload, signal) =>
      method === "sendMessage" && (payload as { text?: string }).text === "Big news"
        ? Promise.resolve({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities",
          } as never)
        : prev(method, payload, signal),
    );

    await feed(h.bot, messageUpdate({ text: "Big news" }));

    expect(h.api.text("sendMessage", -1)).toBe(
      `${INPUT_SCREEN}\n\n⚠️ Telegram refused to send this message. Send another one.`,
    );
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "announce" });
  });
});

describe("/announce: the preview (V1-38)", () => {
  it("ticks a box and edits the control screen only", async () => {
    const h = harness();
    await openPreview(h);

    await feed(h.bot, callbackUpdate(`adm:ann:tg:b:${draftId(h)}`));

    expect(h.api.screen()).toBe(
      previewScreen("Type: text · 8/4096 characters", ["☑️ Announcements", "☑️ Bot channel"]),
    );
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })[0]).toEqual([
      "☑️ Announcements",
      "☑️ Bot channel",
    ]);
    expect(draftOf(h)?.targets).toEqual({ announcements: true, botChannel: true });
  });

  it("refuses Publish without a channel: the alert, and the flag on the screen", async () => {
    const h = harness();
    await openPreview(h);
    await feed(h.bot, callbackUpdate(`adm:ann:tg:a:${draftId(h)}`));

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${draftId(h)}`));

    expect(h.api.lastAlert()).toMatchObject({
      text: "Select at least one channel.",
      show_alert: true,
    });
    expect(h.api.screen()).toBe(
      `${previewScreen("Type: text · 8/4096 characters", ["⬜ Announcements", "⬜ Bot channel"])}\n\n⚠️ No channel selected. Tick at least one channel.`,
    );
    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toEqual([]);
  });

  it("Edit: the preview goes, the input comes back with the draft, the boxes stay", async () => {
    const h = harness();
    await openPreview(h);
    const id = draftId(h);
    await feed(h.bot, callbackUpdate(`adm:ann:tg:b:${id}`));

    await feed(h.bot, callbackUpdate(`adm:ann:edit:${id}`));

    expect(h.api.of("deleteMessage")[0]?.payload).toMatchObject({
      chat_id: CHAT_ID,
      message_id: FIRST_MESSAGE_ID + 1,
    });
    expect(h.api.screen()).toBe(
      [
        "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
        "",
        "Send the announcement (text or photo with caption).",
        "",
        "Current: text · 8 characters. Your next message replaces it.",
        "Formatting and links are kept as sent.",
        "Text: 4096 characters max · Caption: 1024 characters max",
        "Default channel: Announcements",
      ].join("\n"),
    );
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "announce" });

    await feed(h.bot, messageUpdate({ text: "Better news" }));

    expect(h.api.text("sendMessage", -1)).toBe(
      previewScreen("Type: text · 11/4096 characters", ["☑️ Announcements", "☑️ Bot channel"]),
    );
    expect(draftOf(h)).toMatchObject({ id, status: "PREVIEW", content: { text: "Better news" } });
  });

  it("Cancel at the input publishes nothing and ends the input", async () => {
    const h = harness();
    await feed(h.bot, textUpdate("/announce"));

    await feed(h.bot, callbackUpdate(`adm:ann:cancel:${draftId(h)}`));

    expect(h.api.screen()).toBe(
      ["<b>📣 ANNOUNCE</b> · 🧪 Devnet", "", "❌ Canceled. Nothing was published."].join("\n"),
    );
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🏠 Menu"],
    ]);
    expect(storedSession(h.prisma)).not.toHaveProperty("announce");
    expect(storedSession(h.prisma)).not.toHaveProperty("pendingInput");
  });

  it("Cancel on the preview deletes it and publishes nothing", async () => {
    const h = harness();
    await openPreview(h);

    await feed(h.bot, callbackUpdate(`adm:ann:cancel:${draftId(h)}`));

    expect(h.api.of("deleteMessage")[0]?.payload["message_id"]).toBe(FIRST_MESSAGE_ID + 1);
    expect(h.api.screen()).toContain("❌ Canceled. Nothing was published.");
    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toEqual([]);
    expect(draftOf(h)).toBeUndefined();
  });

  it("makes the buttons of an older draft inactive", async () => {
    const h = harness();
    await openPreview(h);
    const old = draftId(h);
    await feed(h.bot, textUpdate("/announce"));

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${old}`));

    expect(h.api.lastAlert()).toMatchObject({
      text: "This preview is no longer active.",
      show_alert: true,
    });
    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toEqual([]);
    expect(draftOf(h)?.status).toBe("AWAITING_INPUT");
  });
});

describe("/announce: the posts (V1-38)", () => {
  it("posts in Announcements then the bot channel, as sent, and says so", async () => {
    const logs = captureLogs();
    const h = harness();
    await openPreview(h);
    await feed(h.bot, callbackUpdate(`adm:ann:tg:b:${draftId(h)}`));
    const before = h.api.calls.length;

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${draftId(h)}`));

    // The click is answered first, then the posts go out in the order of §5.
    expect(h.api.calls.slice(before).map((call) => [call.method, call.payload["chat_id"]])).toEqual(
      [
        ["answerCallbackQuery", undefined],
        ["sendMessage", TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID],
        ["sendMessage", TEST_ENV.CHANNEL_BOT_ID],
        ["editMessageText", CHAT_ID],
      ],
    );
    for (const post of [
      ...postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID),
      ...postsIn(h, TEST_ENV.CHANNEL_BOT_ID),
    ]) {
      expect(post.payload).toEqual({
        chat_id: post.payload["chat_id"],
        text: "Big news",
        entities: BOLD,
      });
    }
    expect(h.api.screen()).toBe(PUBLISHED);
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🏠 Menu"],
    ]);
    expect(draftOf(h)).toBeUndefined();
    const published = logs.find((line) => line.includes("announce.published")) ?? "";
    expect(published).toContain('"length":8');
    expect(published).not.toContain("Big news");
  });

  it("posts once: a second Publish finds the preview inactive", async () => {
    const h = harness();
    await openPreview(h);
    const id = draftId(h);
    await feed(h.bot, callbackUpdate(`adm:ann:pub:${id}`));

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${id}`));

    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toHaveLength(1);
    expect(h.api.lastAlert()).toMatchObject({ text: "This preview is no longer active." });
  });

  it("says which channel refused, and Try again posts in that one only", async () => {
    const h = harness();
    await openPreview(h);
    const id = draftId(h);
    await feed(h.bot, callbackUpdate(`adm:ann:tg:b:${id}`));
    const failing = failPostsIn(
      h,
      TEST_ENV.CHANNEL_BOT_ID,
      403,
      "Forbidden: bot is not a member of the channel chat",
    );

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${id}`));

    expect(h.api.screen()).toBe(
      [
        "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
        "",
        "⚠️ Published in 1 of 2 channels.",
        "",
        "📣 Announcements · ✅",
        "📢 Bot channel · ❌ The bot can't post in this channel.",
      ].join("\n"),
    );
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🔁 Try again"],
      ["🏠 Menu"],
    ]);
    expect(draftOf(h)).toMatchObject({
      status: "DONE",
      results: { botChannel: { ok: false, reason: "cant_post" } },
    });

    failing.on = false;
    await feed(h.bot, callbackUpdate(`adm:ann:retry:${id}`));

    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toHaveLength(1);
    expect(postsIn(h, TEST_ENV.CHANNEL_BOT_ID)).toHaveLength(2);
    expect(h.api.screen()).toBe(PUBLISHED);
    expect(draftOf(h)).toBeUndefined();
  });

  it("says nothing was published when every channel refused", async () => {
    const h = harness();
    await openPreview(h);
    failPostsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID, 400, "Bad Request: chat not found");

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${draftId(h)}`));

    expect(h.api.screen()).toBe(
      [
        "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
        "",
        "❌ Nothing was published.",
        "",
        "📣 Announcements · ❌ The bot can't post in this channel.",
      ].join("\n"),
    );
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🔁 Try again"],
      ["🏠 Menu"],
    ]);
  });

  it("writes PUBLISHING and each answer to the session before the next post", async () => {
    const h = harness();
    await openPreview(h);
    await feed(h.bot, callbackUpdate(`adm:ann:tg:b:${draftId(h)}`));
    let seen: AnnounceState | undefined;
    h.bot.api.config.use((prev, method, payload, signal) => {
      if ((payload as { chat_id?: unknown }).chat_id === TEST_ENV.CHANNEL_BOT_ID) {
        seen = draftOf(h);
      }
      return prev(method, payload, signal);
    });

    await feed(h.bot, callbackUpdate(`adm:ann:pub:${draftId(h)}`));

    expect(seen).toMatchObject({
      status: "PUBLISHING",
      results: { announcements: { ok: true } },
    });
    expect(seen?.results).not.toHaveProperty("botChannel");
  });

  it("shows a draft stopped mid-publish as unknown, posts nothing, then Try again", async () => {
    const h = harness();
    const stopped: AnnounceState = {
      id: "AbCd1234",
      status: "PUBLISHING",
      content: { kind: "text", text: "Big news" },
      targets: { announcements: true, botChannel: true },
      results: { announcements: { ok: true, messageId: 900 } },
      previewMessageId: 101,
    };
    h.prisma.sessions.set(
      String(CHAT_ID),
      JSON.stringify({ v: SESSION_VERSION, announce: stopped }),
    );

    await feed(h.bot, callbackUpdate("adm:ann:pub:AbCd1234"));

    expect(h.api.lastAlert()).toMatchObject({ text: "This preview is no longer active." });
    expect(h.api.screen()).toBe(
      [
        "<b>📣 ANNOUNCE</b> · 🧪 Devnet",
        "",
        "⚠️ Published in 1 of 2 channels.",
        "",
        "📣 Announcements · ✅",
        "📢 Bot channel · ❌ Unknown result. Check the channel before trying again.",
      ].join("\n"),
    );
    expect(postsIn(h, TEST_ENV.CHANNEL_BOT_ID)).toEqual([]);

    await feed(h.bot, callbackUpdate("adm:ann:retry:AbCd1234"));

    expect(postsIn(h, TEST_ENV.CHANNEL_ANNOUNCEMENTS_ID)).toEqual([]);
    expect(postsIn(h, TEST_ENV.CHANNEL_BOT_ID)).toHaveLength(1);
    expect(h.api.screen()).toBe(PUBLISHED);
  });
});
