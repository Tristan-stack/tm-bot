import { InputFile } from "grammy";
import type { Api } from "grammy";
import type { InlineKeyboardMarkup, InputMedia } from "grammy/types";
import { isNotModified, isUneditable } from "../../navigation/telegram-errors.js";
import type { EditOutcome, SimMessage, SimTelegram } from "../../services/sim-runner.js";

const PICTURE_NAME = "simulation.png";
const CARD_NAME = "pnl-card.mp4";

/**
 * The message of a simulation (§6.1) on the Bot API: a photo sent once with `protect_content`
 * (no forward, no save), edited in place with `editMessageMedia`, then turned into the
 * animation of the card (§6.3: an MP4 without sound, played in a loop). HTML captions, like
 * every screen of the bot.
 */
export function simTelegram(api: Api): SimTelegram {
  async function editMedia(
    { chatId, messageId }: SimMessage,
    media: InputMedia,
    keyboard: InlineKeyboardMarkup,
  ): Promise<EditOutcome> {
    try {
      await api.editMessageMedia(chatId, messageId, media, { reply_markup: keyboard });
      return "edited";
    } catch (error) {
      // Identical content: as good as edited.
      if (isNotModified(error)) return "edited";
      if (isUneditable(error)) return "gone";
      throw error;
    }
  }

  return {
    async sendPhoto(chatId, png, caption, keyboard) {
      const message = await api.sendPhoto(chatId, new InputFile(png, PICTURE_NAME), {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
        protect_content: true,
      });
      return message.message_id;
    },

    editPhoto: (target, png, caption, keyboard) =>
      editMedia(
        target,
        { type: "photo", media: new InputFile(png, PICTURE_NAME), caption, parse_mode: "HTML" },
        keyboard,
      ),

    editAnimation: (target, mp4, caption, keyboard) =>
      editMedia(
        target,
        { type: "animation", media: new InputFile(mp4, CARD_NAME), caption, parse_mode: "HTML" },
        keyboard,
      ),
  };
}
