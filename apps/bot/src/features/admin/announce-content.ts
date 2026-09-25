import { TG } from "@launchbot/shared";
import type { Message, PhotoSize } from "grammy/types";
import type { AnnounceContent } from "../../context.js";

/** Why a message cannot be an announcement (§3 of V1-38): the input screen says it again. */
export type AnnounceIssue =
  { code: "unsupported" } | { code: "no_caption" } | { code: "caption_too_long"; length: number };

export type AnnounceParse =
  { ok: true; content: AnnounceContent } | { ok: false; issue: AnnounceIssue };

/** The biggest size of a photo: Telegram lists them smallest first, the area decides anyway. */
const largest = (sizes: PhotoSize[]): PhotoSize | undefined =>
  sizes.reduce<PhotoSize | undefined>(
    (best, size) =>
      best === undefined || size.width * size.height > best.width * best.height ? size : best,
    undefined,
  );

/**
 * A text, or one photo with a caption, kept as sent: its entities, the link preview options of a
 * text. Anything else is refused (a video, a document, an image sent as a file, a sticker, an
 * album). Lengths are counted like Telegram's limits, in UTF-16 code units.
 */
export function announceContentOf(message: Message): AnnounceParse {
  // One message of an album: the others would never be published with it.
  if (message.media_group_id !== undefined) return { ok: false, issue: { code: "unsupported" } };
  if (message.text !== undefined) {
    return {
      ok: true,
      content: {
        kind: "text",
        text: message.text,
        ...(message.entities === undefined ? {} : { entities: message.entities }),
        ...(message.link_preview_options === undefined
          ? {}
          : { linkPreview: message.link_preview_options }),
      },
    };
  }
  const photo = message.photo === undefined ? undefined : largest(message.photo);
  if (photo === undefined) return { ok: false, issue: { code: "unsupported" } };
  const caption = message.caption ?? "";
  if (caption.trim() === "") return { ok: false, issue: { code: "no_caption" } };
  // A Premium account writes longer captions than a bot may send.
  if (caption.length > TG.CAPTION_MAX_CHARS) {
    return { ok: false, issue: { code: "caption_too_long", length: caption.length } };
  }
  return {
    ok: true,
    content: {
      kind: "photo",
      fileId: photo.file_id,
      caption,
      ...(message.caption_entities === undefined
        ? {}
        : { captionEntities: message.caption_entities }),
    },
  };
}

/** What the draft holds, as its screens count it: the text or the caption. */
export const announceLength = (content: AnnounceContent): number =>
  content.kind === "text" ? content.text.length : content.caption.length;
