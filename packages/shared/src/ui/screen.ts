import type { InlineKeyboardButton, InlineKeyboardMarkup } from "@grammyjs/types";
import { NAV_HOME } from "../callback.js";
import type { CallbackData } from "../callback.js";
import { TG } from "../constants.js";
import { en } from "../i18n/en.js";
import { escapeHtml } from "./html.js";

export type Button = InlineKeyboardButton;

/** Spread into `sendMessage` / `editMessageText`: HTML, link previews disabled (§4.3). */
export type Screen = {
  text: string;
  reply_markup: InlineKeyboardMarkup;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
};

type Block = string | string[];
type BlockName = "description" | "info" | "flags" | "footer";

export type ScreenParams = {
  header: string;
  /** One or two sentences: what the screen is for and what the user must do. */
  description?: Block;
  /** The state needed to decide: balances, choices already made, amounts, fees. */
  info?: Block;
  /**
   * Blockers and warnings in plain text, with the object and what is missing:
   * `⚠️ Insufficient funds (0.650 SOL missing)`. Written counterpart of every alert (§4.5).
   */
  flags?: string[];
  /** `🕒 Updated 14:32 UTC` */
  footer?: string;
  keyboard: Button[][];
  /** For the mockups where the summary comes before the description (Dev buy, §6). */
  order?: BlockName[];
};

const DEFAULT_ORDER: BlockName[] = ["description", "info", "flags", "footer"];

export class ScreenTooLongError extends Error {
  constructor(length: number) {
    super(`Screen text is ${length} characters long, Telegram allows ${TG.MESSAGE_MAX_CHARS}`);
    this.name = "ScreenTooLongError";
  }
}

const blockText = (block: Block | undefined): string =>
  (typeof block === "string" ? [block] : (block ?? []))
    .filter((line) => line.trim() !== "")
    .join("\n");

/**
 * Builds a screen (§4.5): header, description, info, flags, footer, then the keyboard.
 * Blocks are separated by an empty line, empty blocks are left out. Blocks are trusted HTML:
 * user values are escaped by the caller (`escapeHtml`, `b`, `code`, `a`).
 */
export function renderScreen(params: ScreenParams): Screen {
  const blocks: Record<BlockName, string> = {
    description: blockText(params.description),
    info: blockText(params.info),
    flags: blockText(params.flags),
    footer: blockText(params.footer),
  };
  // §15: no screen shows buttons only.
  if (blocks.description === "" && blocks.info === "") {
    throw new Error("A screen needs a description or info above its keyboard");
  }

  const order = [...new Set([...(params.order ?? []), ...DEFAULT_ORDER])];
  const text = [params.header, ...order.map((name) => blocks[name])]
    .filter((block) => block !== "")
    .join("\n\n");
  // The limit applies after entity parsing: measuring the HTML is a safe upper bound.
  if (text.length > TG.MESSAGE_MAX_CHARS) throw new ScreenTooLongError(text.length);

  return {
    text,
    reply_markup: { inline_keyboard: params.keyboard },
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
}

export type InputScreenParams = {
  header: string;
  /** What the user must send. */
  prompt: string;
  /** Plain text, escaped here. `null`: the field is empty. Omitted: no "Current" line. */
  current?: string | null;
  /** Length, format, bounds. */
  rules: string[];
  keyboard: Button[][];
};

/** Input screen (§4.5): shows the current value and the rules, and always has a Cancel button. */
export function renderInputScreen(params: InputScreenParams): Screen {
  const { header, prompt, current, rules, keyboard } = params;
  // §15: every input has a "Cancel".
  if (!keyboard.flat().some((button) => button.text === en.btn.cancel)) {
    throw new Error(`An input screen needs a "${en.btn.cancel}" button`);
  }
  const currentLine =
    current === undefined ? [] : [en.common.current(escapeHtml(current ?? en.common.none))];
  return renderScreen({ header, description: prompt, info: [...currentLine, ...rules], keyboard });
}

/**
 * A titled list drawn as a tree (§4.3, §9.1). Lines are trusted HTML, like every block.
 *
 *     <b>👤 ACCOUNT</b>
 *     ┌ @username
 *     ├ 🆔 123456789
 *     └ 👛 No wallet yet
 */
export function tree(title: string, lines: string[]): string {
  const last = lines.length - 1;
  const branch = (index: number) => (index === last ? "└" : index === 0 ? "┌" : "├");
  return [`<b>${title}</b>`, ...lines.map((line, index) => `${branch(index)} ${line}`)].join("\n");
}

/** `data` comes from `encodeCallback`, which has already checked its format and its size. */
export const cbBtn = (label: string, data: CallbackData): Button => ({
  text: label,
  callback_data: data,
});

/** The Cancel button every input screen must have (§15). */
export const cancelBtn = (data: CallbackData): Button => cbBtn(en.btn.cancel, data);

export const urlBtn = (label: string, url: string): Button => ({ text: label, url });

export const webAppBtn = (label: string, url: string): Button => ({
  text: label,
  web_app: { url },
});

/**
 * `[ ⬅️ Back ][ 🏠 Menu ]` (§4.4): every sub-screen has Back, deep screens also have Menu.
 * Menu is `nav:home`, the same callback as a Back to the home screen.
 */
export const navRow = (backData: CallbackData, options: { menu?: boolean } = {}): Button[] => [
  cbBtn(en.btn.back, backData),
  ...(options.menu === true ? [cbBtn(en.btn.menu, NAV_HOME)] : []),
];
