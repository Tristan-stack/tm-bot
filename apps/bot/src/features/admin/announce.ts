import { en } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { z } from "zod";
import { ANNOUNCE_CHANNELS } from "../../context.js";
import type { AnnounceChannel, AnnounceContent, AnnounceState, BotContext } from "../../context.js";
import { newNonce } from "../../navigation/confirm-token.js";
import type { InputHandler } from "../../navigation/inputs.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { blockWithFlag, showScreen } from "../../navigation/show-screen.js";
import { isAlreadyDeleted, telegramErrorFields } from "../../navigation/telegram-errors.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import { announceContentOf, announceLength } from "./announce-content.js";
import type { AnnounceIssue } from "./announce-content.js";
import { postAnnouncement, sendAnnouncement } from "./announce-publisher.js";
import {
  allPosted,
  buildAnnounceCanceledScreen,
  buildAnnounceInputScreen,
  buildAnnouncePreviewScreen,
  buildAnnounceResultScreen,
} from "./announce-screens.js";
import { ANNOUNCE_CHANNEL_CODES } from "./common.js";
import type { AdminKit } from "./common.js";

const log = createLogger("bot:admin:announce");
const texts = en.admin.announce;

/** The input of a draft: its draft is in `session.announce`. */
const INPUT = { kind: "announce" } as const;
/** `/announce` takes no argument: the message comes next (§2 of V1-38). */
const NO_ARGS = z.tuple([]);

export type AnnounceDeps = {
  kit: AdminKit;
  /** `CHANNEL_ANNOUNCEMENTS_ID` and `CHANNEL_BOT_ID` (§12). */
  chatIds: Record<AnnounceChannel, string>;
  /** `saveSessionNow`: the posts are recorded as they go, not at the end of the click. */
  saveSession: (ctx: BotContext) => Promise<void>;
  /** The wait before a rate-limited post is sent again (tests). */
  sleep?: (ms: number) => Promise<unknown>;
};

const issueFlag = (issue: AnnounceIssue): string => {
  switch (issue.code) {
    case "caption_too_long":
      return texts.captionTooLong(issue.length);
    case "no_caption":
      return texts.noCaption;
    default:
      return texts.unsupported;
  }
};

/** The posts made: a new attempt keeps them and sends the other channels again. */
function postsOf(results: AnnounceState["results"]): AnnounceState["results"] {
  const posts: AnnounceState["results"] = {};
  for (const channel of ANNOUNCE_CHANNELS) {
    const result = results[channel];
    if (result?.ok === true) posts[channel] = result;
  }
  return posts;
}

/**
 * `/announce` (§3, §11.4, V1-38): the message of the admin, its preview, the channels, then the
 * posts. Nothing is posted without the preview and a click on Publish (§15).
 */
export function createAnnounce(deps: AnnounceDeps): {
  command: (ctx: BotContext) => Promise<unknown>;
  input: InputHandler<"announce">;
  callback: CallbackHandler;
} {
  const { kit, chatIds, saveSession, sleep } = deps;
  const { ui } = kit;

  const showInput = (ctx: BotContext, state: AnnounceState, flag?: string) =>
    showScreen(ctx, buildAnnounceInputScreen(ui, state, flag), { input: INPUT });

  /** The preview goes with its draft: best effort, the admin may have deleted it. */
  async function deletePreview(ctx: BotContext, state: AnnounceState): Promise<void> {
    if (state.previewMessageId === undefined || ctx.chatId === undefined) return;
    try {
      await ctx.api.deleteMessage(ctx.chatId, state.previewMessageId);
    } catch (error) {
      if (!isAlreadyDeleted(error)) {
        log.warn(telegramErrorFields(error), "announce.preview_not_deleted");
      }
    }
  }

  /**
   * A button of another draft, or of this one at another step (§5): the alert, nothing is sent.
   * A draft still `PUBLISHING` was stopped by the process in the middle of its posts (proposal of
   * V1-38): the channels without an answer show « Unknown result » and Try again, for the admin
   * to check the channel first.
   */
  async function inactive(
    ctx: BotContext,
    state: AnnounceState | undefined,
    id: string,
  ): Promise<unknown> {
    await notify(ctx, texts.inactive, { alert: true });
    if (state?.id !== id || state.status !== "PUBLISHING") return;
    const results = { ...state.results };
    for (const channel of ANNOUNCE_CHANNELS) {
      if (state.targets[channel] && results[channel] === undefined) {
        results[channel] = { ok: false, reason: "unknown" };
      }
    }
    const done: AnnounceState = { ...state, status: "DONE", results };
    ctx.session.announce = done;
    log.warn({ adminTelegramId: ctx.user.telegramId.toString() }, "announce.interrupted");
    return showScreen(ctx, buildAnnounceResultScreen(ui, done));
  }

  /**
   * Posts in the channels ticked that have no post yet, Announcements then Bot channel (§5).
   * `PUBLISHING` and each answer reach the session at once: after a restart in between, the
   * draft says so instead of posting twice.
   */
  async function publish(
    ctx: BotContext,
    state: AnnounceState & { content: AnnounceContent },
  ): Promise<unknown> {
    // A post takes a moment, a rate limit up to 30 s: the click is answered now.
    await acknowledge(ctx);
    let current: AnnounceState = {
      ...state,
      status: "PUBLISHING",
      results: postsOf(state.results),
    };
    ctx.session.announce = current;
    await saveSession(ctx);
    for (const channel of ANNOUNCE_CHANNELS) {
      if (!current.targets[channel] || current.results[channel] !== undefined) continue;
      const result = await postAnnouncement(ctx.api, chatIds[channel], state.content, sleep);
      current = { ...current, results: { ...current.results, [channel]: result } };
      ctx.session.announce = current;
      await saveSession(ctx);
    }

    const done: AnnounceState = { ...current, status: "DONE" };
    log.info(
      {
        adminTelegramId: ctx.user.telegramId.toString(),
        type: state.content.kind,
        length: announceLength(state.content),
        // The ids of the posts, never their text.
        posts: Object.fromEntries(
          ANNOUNCE_CHANNELS.flatMap((channel) => {
            const result = done.results[channel];
            return result?.ok === true ? [[channel, result.messageId]] : [];
          }),
        ),
        failed: ANNOUNCE_CHANNELS.filter((channel) => done.results[channel]?.ok === false),
      },
      "announce.published",
    );
    // Every post made: the draft has nothing left to do, and its buttons are inactive.
    if (allPosted(done)) delete ctx.session.announce;
    else ctx.session.announce = done;
    return showScreen(ctx, buildAnnounceResultScreen(ui, done));
  }

  async function toggle(ctx: BotContext, code?: string, id?: string): Promise<unknown> {
    const channel = ANNOUNCE_CHANNELS.find((name) => ANNOUNCE_CHANNEL_CODES[name] === code);
    if (channel === undefined || id === undefined) return notify(ctx, en.common.staleButton);
    const state = ctx.session.announce;
    if (state?.id !== id || state.status !== "PREVIEW") return inactive(ctx, state, id);
    const next = { ...state, targets: { ...state.targets, [channel]: !state.targets[channel] } };
    ctx.session.announce = next;
    return showScreen(ctx, buildAnnouncePreviewScreen(ui, next));
  }

  async function publishClick(ctx: BotContext, id: string): Promise<unknown> {
    const state = ctx.session.announce;
    if (state?.id !== id || state.status !== "PREVIEW") return inactive(ctx, state, id);
    if (!ANNOUNCE_CHANNELS.some((channel) => state.targets[channel])) {
      return blockWithFlag(ctx, texts.noChannel, (flag) =>
        buildAnnouncePreviewScreen(ui, state, flag),
      );
    }
    return publish(ctx, state);
  }

  /** ✏️ Edit (§4): the preview goes, the input comes back with the draft and its boxes. */
  async function edit(ctx: BotContext, id: string): Promise<unknown> {
    const state = ctx.session.announce;
    if (state?.id !== id || state.status !== "PREVIEW") return inactive(ctx, state, id);
    await deletePreview(ctx, state);
    const next: AnnounceState = {
      id,
      status: "AWAITING_INPUT",
      content: state.content,
      targets: state.targets,
      results: {},
    };
    ctx.session.announce = next;
    return showInput(ctx, next);
  }

  async function cancel(ctx: BotContext, id: string): Promise<unknown> {
    const state = ctx.session.announce;
    if (state?.id !== id || (state.status !== "AWAITING_INPUT" && state.status !== "PREVIEW")) {
      return inactive(ctx, state, id);
    }
    await deletePreview(ctx, state);
    delete ctx.session.announce;
    return showScreen(ctx, buildAnnounceCanceledScreen(ui));
  }

  /** 🔁 Try again (§5): only the channels ticked that still have no post. */
  async function retry(ctx: BotContext, id: string): Promise<unknown> {
    const state = ctx.session.announce;
    if (state?.id !== id || state.status !== "DONE") return inactive(ctx, state, id);
    return publish(ctx, state);
  }

  return {
    async command(ctx) {
      if ((await kit.parseArgs(ctx, "announce", NO_ARGS)) === null) return;
      // A new draft each time: the buttons of the previous one become inactive.
      const state: AnnounceState = {
        id: newNonce(8),
        status: "AWAITING_INPUT",
        targets: { announcements: true, botChannel: false },
        results: {},
      };
      ctx.session.announce = state;
      return showScreen(ctx, buildAnnounceInputScreen(ui, state), { mode: "new", input: INPUT });
    },

    async input(ctx) {
      const state = ctx.session.announce;
      const message = ctx.message;
      if (state?.status !== "AWAITING_INPUT" || message === undefined) {
        // An input without its draft: the message is not an announcement.
        delete ctx.session.pendingInput;
        return;
      }
      const parsed = announceContentOf(message);
      // Refused: the input again, under the message, saying what is wrong (§3).
      if (!parsed.ok) {
        await showInput(ctx, state, issueFlag(parsed.issue));
        return;
      }
      let previewMessageId: number;
      try {
        previewMessageId = await sendAnnouncement(ctx.api, message.chat.id, parsed.content);
      } catch (error) {
        log.warn(telegramErrorFields(error), "announce.preview_failed");
        await showInput(ctx, state, texts.previewFailed);
        return;
      }
      const next: AnnounceState = {
        ...state,
        status: "PREVIEW",
        content: parsed.content,
        previewMessageId,
      };
      ctx.session.announce = next;
      // Under the preview; the input above loses its Cancel.
      await showScreen(ctx, buildAnnouncePreviewScreen(ui, next));
    },

    callback(ctx, [action, first, second]) {
      if (action === "tg") return toggle(ctx, first, second);
      if (first === undefined) return notify(ctx, en.common.staleButton);
      switch (action) {
        case "pub":
          return publishClick(ctx, first);
        case "edit":
          return edit(ctx, first);
        case "cancel":
          return cancel(ctx, first);
        case "retry":
          return retry(ctx, first);
        default:
          return notify(ctx, en.common.staleButton);
      }
    },
  };
}
