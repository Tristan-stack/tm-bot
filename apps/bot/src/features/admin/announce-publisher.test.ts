import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { GrammyError, HttpError } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnounceContent } from "../../context.js";
import { postAnnouncement, sendAnnouncement } from "./announce-publisher.js";
import type { AnnounceApi } from "./announce-publisher.js";

afterEach(() => {
  setLogDestination(undefined);
});

const CHANNEL = "-1001000000003";
const TEXT: AnnounceContent = {
  kind: "text",
  text: "Big news",
  entities: [{ type: "bold", offset: 0, length: 3 }],
  linkPreview: { is_disabled: true },
};
const PHOTO: AnnounceContent = {
  kind: "photo",
  fileId: "photo-1",
  caption: "New look",
  captionEntities: [{ type: "italic", offset: 4, length: 4 }],
};

/** A refusal of the Bot API, built the way grammY builds it. */
const refusal = (code: number, description: string, retryAfter?: number): GrammyError =>
  new GrammyError(
    "Call to 'sendMessage' failed!",
    {
      ok: false,
      error_code: code,
      description,
      ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
    },
    "sendMessage",
    {},
  );

/** `sendMessage` answers each call with the next outcome: a message id, or an error thrown. */
function fakeApi(...outcomes: (number | Error)[]) {
  const answer = () => {
    const next = outcomes.shift() ?? 1;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve({ message_id: next });
  };
  const api = { sendMessage: vi.fn(answer), sendPhoto: vi.fn(answer) };
  return api as typeof api & AnnounceApi;
}

describe("sendAnnouncement (V1-38)", () => {
  it("sends a text with its entities and link preview options, without parse_mode", async () => {
    const api = fakeApi(42);

    expect(await sendAnnouncement(api, CHANNEL, TEXT)).toBe(42);
    expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith(CHANNEL, "Big news", {
      entities: [{ type: "bold", offset: 0, length: 3 }],
      link_preview_options: { is_disabled: true },
    });
  });

  it("sends a photo by its file_id with its caption and caption entities", async () => {
    const api = fakeApi(43);

    expect(await sendAnnouncement(api, 777, PHOTO)).toBe(43);
    expect(api.sendPhoto).toHaveBeenCalledExactlyOnceWith(777, "photo-1", {
      caption: "New look",
      caption_entities: [{ type: "italic", offset: 4, length: 4 }],
    });
  });

  it("sends a plain text with no option at all", async () => {
    const api = fakeApi(44);

    await sendAnnouncement(api, CHANNEL, { kind: "text", text: "Hello" });

    expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith(CHANNEL, "Hello", {});
  });
});

describe("postAnnouncement (V1-38)", () => {
  it("returns the id of the post", async () => {
    expect(await postAnnouncement(fakeApi(50), CHANNEL, TEXT)).toEqual({ ok: true, messageId: 50 });
  });

  it.each([
    [
      "the bot removed from the channel",
      refusal(403, "Forbidden: bot was kicked from the channel chat"),
    ],
    ["a channel that does not exist", refusal(400, "Bad Request: chat not found")],
    [
      "no right to post",
      refusal(400, "Bad Request: not enough rights to send text messages to the chat"),
    ],
    [
      "a bot that is not an admin",
      refusal(400, "Bad Request: need administrator rights in the channel chat"),
    ],
  ])("says the bot can't post for %s", async (_case, error) => {
    expect(await postAnnouncement(fakeApi(error), CHANNEL, TEXT)).toEqual({
      ok: false,
      reason: "cant_post",
    });
  });

  it("waits the retry_after of a 429, then posts", async () => {
    const api = fakeApi(refusal(429, "Too Many Requests: retry after 12", 12), 51);
    const sleep = vi.fn(() => Promise.resolve());

    expect(await postAnnouncement(api, CHANNEL, TEXT, sleep)).toEqual({ ok: true, messageId: 51 });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(12_000);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("tries a 429 once only", async () => {
    const limited = () => refusal(429, "Too Many Requests: retry after 5", 5);
    const api = fakeApi(limited(), limited(), 52);

    expect(await postAnnouncement(api, CHANNEL, TEXT, () => Promise.resolve())).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not wait more than 30 s: the channel fails at once", async () => {
    const api = fakeApi(refusal(429, "Too Many Requests: retry after 31", 31), 53);
    const sleep = vi.fn(() => Promise.resolve());

    expect(await postAnnouncement(api, CHANNEL, TEXT, sleep)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("calls anything else a Telegram error, and logs it without the text sent", async () => {
    const logs = captureLogs();
    const network = new HttpError("Network request for 'sendMessage' failed!", new Error("boom"));

    expect(await postAnnouncement(fakeApi(network), CHANNEL, TEXT)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(
      await postAnnouncement(
        fakeApi(refusal(400, "Bad Request: can't parse entities")),
        CHANNEL,
        TEXT,
      ),
    ).toEqual({
      ok: false,
      reason: "error",
    });
    expect(logs.join("\n")).toContain("announce.post_failed");
    expect(logs.join("\n")).not.toContain("Big news");
  });
});
