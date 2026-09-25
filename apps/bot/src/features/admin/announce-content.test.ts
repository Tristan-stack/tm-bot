import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import { announceContentOf, announceLength } from "./announce-content.js";

/** The fields of a message the parser reads; the rest of a Telegram message does not matter. */
const message = (fields: Partial<Message>): Message =>
  ({ message_id: 10, date: 0, chat: { id: 777, type: "private" }, ...fields }) as Message;

const size = (fileId: string, width: number, height: number) => ({
  file_id: fileId,
  file_unique_id: `u-${fileId}`,
  width,
  height,
});

describe("announceContentOf (V1-38)", () => {
  it("keeps a text with its entities and its link preview options", () => {
    const entities = [
      { type: "bold" as const, offset: 0, length: 4 },
      { type: "text_link" as const, offset: 5, length: 4, url: "https://example.com" },
    ];
    const linkPreview = { url: "https://example.com", prefer_small_media: true };

    expect(
      announceContentOf(
        message({ text: "News here", entities, link_preview_options: linkPreview }),
      ),
    ).toEqual({
      ok: true,
      content: { kind: "text", text: "News here", entities, linkPreview },
    });
  });

  it("keeps a plain text as is", () => {
    expect(announceContentOf(message({ text: "Maintenance at 14:00 UTC." }))).toEqual({
      ok: true,
      content: { kind: "text", text: "Maintenance at 14:00 UTC." },
    });
  });

  it("keeps the biggest size of a photo, its caption and their entities", () => {
    const captionEntities = [{ type: "italic" as const, offset: 0, length: 3 }];
    const parsed = announceContentOf(
      message({
        photo: [size("small", 90, 60), size("big", 1280, 853), size("medium", 320, 213)],
        caption: "New feature",
        caption_entities: captionEntities,
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      content: { kind: "photo", fileId: "big", caption: "New feature", captionEntities },
    });
  });

  it.each([
    ["no caption", undefined],
    ["a blank caption", "   "],
  ])("refuses a photo with %s", (_case, caption) => {
    const fields = caption === undefined ? {} : { caption };
    expect(announceContentOf(message({ photo: [size("p", 90, 60)], ...fields }))).toEqual({
      ok: false,
      issue: { code: "no_caption" },
    });
  });

  it("takes a caption of 1024 characters and refuses 1025, measured in UTF-16", () => {
    const photo = [size("p", 90, 60)];

    expect(announceContentOf(message({ photo, caption: "a".repeat(1024) })).ok).toBe(true);
    expect(announceContentOf(message({ photo, caption: "a".repeat(1025) }))).toEqual({
      ok: false,
      issue: { code: "caption_too_long", length: 1025 },
    });
    // An emoji is two units, as Telegram counts it.
    expect(announceContentOf(message({ photo, caption: "🚀".repeat(513) }))).toEqual({
      ok: false,
      issue: { code: "caption_too_long", length: 1026 },
    });
  });

  it.each([
    ["a video", { video: { file_id: "v", file_unique_id: "v", width: 1, height: 1, duration: 1 } }],
    [
      "an image sent as a file",
      { document: { file_id: "d", file_unique_id: "d", mime_type: "image/png" } },
    ],
    [
      "a sticker",
      {
        sticker: {
          file_id: "s",
          file_unique_id: "s",
          type: "regular",
          width: 1,
          height: 1,
          is_animated: false,
          is_video: false,
        },
      },
    ],
    ["a photo of an album", { photo: [size("p", 90, 60)], caption: "1/2", media_group_id: "g" }],
    ["a photo without any size", { photo: [], caption: "Hello" }],
  ])("refuses %s", (_case, fields) => {
    expect(announceContentOf(message(fields as Partial<Message>))).toEqual({
      ok: false,
      issue: { code: "unsupported" },
    });
  });

  it("measures the text or the caption", () => {
    expect(announceLength({ kind: "text", text: "Hello 🚀" })).toBe(8);
    expect(announceLength({ kind: "photo", fileId: "p", caption: "Hi" })).toBe(2);
  });
});
