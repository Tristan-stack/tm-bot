import { cbBtn, en, renderInputScreen, renderScreen, TG } from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import { ANNOUNCE_CHANNELS } from "../../context.js";
import type { AnnounceChannel, AnnounceContent, AnnounceState } from "../../context.js";
import { announceLength } from "./announce-content.js";
import { ADMIN_CB, adminHeader, MENU_ROW, renderAdminNotice } from "./common.js";

// /announce (§11.4, V1-38): the input, the control screen under the preview, the result.

const texts = en.admin.announce;

/** `text · 312 characters`: what the draft holds, in the words of its screens. */
const typeOf = (content: AnnounceContent): string => texts.types[content.kind];

/** A box and its channel: `☑️ Announcements`, on the screen and on its button. */
const box = (targets: AnnounceState["targets"], channel: AnnounceChannel): string =>
  (targets[channel] ? texts.checked : texts.unchecked)(texts.channelNames[channel]);

/** The input (§3): the prompt, its rules, and the draft an ✏️ Edit came back with. */
export function buildAnnounceInputScreen(ui: Ui, state: AnnounceState, flag?: string): Screen {
  const { content } = state;
  return renderInputScreen({
    header: adminHeader(ui, "announce"),
    prompt: texts.prompt,
    ...(content === undefined
      ? {}
      : { current: texts.current(typeOf(content), announceLength(content)) }),
    rules: [texts.kept, texts.limits, texts.defaultChannel],
    flags: [flag],
    keyboard: [[cbBtn(en.btn.cancel, ADMIN_CB.announceCancel(state.id))]],
  });
}

/** The control screen under the preview (§4): the boxes, Publish, Edit, Cancel. */
export function buildAnnouncePreviewScreen(
  ui: Ui,
  draft: Pick<AnnounceState, "id" | "targets"> & { content: AnnounceContent },
  flag?: string,
): Screen {
  const { id, targets, content } = draft;
  const max = content.kind === "text" ? TG.MESSAGE_MAX_CHARS : TG.CAPTION_MAX_CHARS;
  return renderScreen({
    header: adminHeader(ui, "announce", texts.previewTitle),
    description: texts.checkPreview,
    info: [
      texts.type(typeOf(content), announceLength(content), max),
      texts.channels,
      ...ANNOUNCE_CHANNELS.map((channel) => box(targets, channel)),
    ],
    flags: [flag],
    keyboard: [
      ANNOUNCE_CHANNELS.map((channel) =>
        cbBtn(box(targets, channel), ADMIN_CB.announceToggle(channel, id)),
      ),
      [cbBtn(texts.btnPublish, ADMIN_CB.announcePublish(id))],
      [
        cbBtn(texts.btnEdit, ADMIN_CB.announceEdit(id)),
        cbBtn(en.btn.cancel, ADMIN_CB.announceCancel(id)),
      ],
    ],
  });
}

/** Every channel ticked has its post. */
export const allPosted = (state: AnnounceState): boolean =>
  ANNOUNCE_CHANNELS.every(
    (channel) => !state.targets[channel] || state.results[channel]?.ok === true,
  );

/**
 * The result (§5): a line per channel ticked. Try again while one has no post, 🏠 Menu always. A
 * channel without an answer is `unknown`: the process stopped while it was being posted.
 */
export function buildAnnounceResultScreen(ui: Ui, state: AnnounceState): Screen {
  const ticked = ANNOUNCE_CHANNELS.filter((channel) => state.targets[channel]);
  const posted = ticked.filter((channel) => state.results[channel]?.ok === true).length;
  const done = allPosted(state);
  return renderScreen({
    header: adminHeader(ui, "announce"),
    description: done
      ? texts.published
      : posted === 0
        ? texts.nothing
        : texts.partly(posted, ticked.length),
    info: ticked.map((channel) => {
      const result = state.results[channel];
      const name = texts.resultLines[channel];
      return result?.ok === true
        ? texts.posted(name)
        : texts.failed(name, texts.failures[result?.reason ?? "unknown"]);
    }),
    keyboard: done
      ? [MENU_ROW]
      : [[cbBtn(texts.btnTryAgain, ADMIN_CB.announceRetry(state.id))], MENU_ROW],
  });
}

/** ❌ Cancel, at the input or on the preview: nothing was published. */
export const buildAnnounceCanceledScreen = (ui: Ui): Screen =>
  renderAdminNotice(ui, "announce", texts.canceled, [MENU_ROW]);
