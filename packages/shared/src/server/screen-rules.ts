import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { TG } from "../constants.js";
import { utf8ByteLength } from "../format/text.js";

// The rules of §4.5 on what really leaves for Telegram (acceptance V1-46), for the tests
// (`@launchbot/shared/test`). The bot's test transport checks every message of every test
// against them, the worker's screens are checked by their own test: a screen that breaks one
// fails the test that drew it.

/** A call to the Bot API, as the fake transport of the tests records it. */
export type SentCall = { method: string; payload: Record<string, unknown> };

/** Methods whose text a user reads, and where that text sits in the payload. */
const TEXT_METHODS = new Set(["sendMessage", "editMessageText"]);
const CAPTION_METHODS = new Set([
  "sendPhoto",
  "sendAnimation",
  "sendVideo",
  "sendDocument",
  "editMessageCaption",
]);

/** Telegram's HTML subset (Bot API, "HTML style"): anything else is refused with a 400. */
const TELEGRAM_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "span",
  "tg-spoiler",
  "a",
  "tg-emoji",
  "code",
  "pre",
  "blockquote",
]);

/** The named entities Telegram knows, and the numeric ones. A bare `&` is refused. */
const ENTITY = /^&(?:lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/i;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' };

/** The text a user sees: tags dropped, entities decoded. Telegram counts its limits on it. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|amp|quot);/g, (_, name: string) => NAMED_ENTITIES[name] ?? "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) =>
      String.fromCodePoint(
        value.startsWith("x") || value.startsWith("X")
          ? Number.parseInt(value.slice(1), 16)
          : Number(value),
      ),
    );
}

/** What Telegram would refuse in an HTML text: an unknown or unclosed tag, a bare `&`. */
export function htmlIssues(html: string): string[] {
  const issues: string[] = [];
  const open: string[] = [];
  for (let i = 0; i < html.length; i += 1) {
    const char = html[i];
    if (char === "&" && !ENTITY.test(html.slice(i))) {
      issues.push(`bare "&" at ${i}: escape it as &amp;`);
    }
    if (char === ">") issues.push(`bare ">" at ${i}: escape it as &gt;`);
    if (char !== "<") continue;
    const end = html.indexOf(">", i);
    if (end === -1) {
      issues.push(`bare "<" at ${i}: escape it as &lt;`);
      break;
    }
    const tag = /^<(\/?)([a-z-]+)(?:\s[^>]*)?>$/i.exec(html.slice(i, end + 1));
    const name = tag?.[2]?.toLowerCase();
    if (tag === null || name === undefined || !TELEGRAM_TAGS.has(name)) {
      issues.push(`tag ${html.slice(i, end + 1)} is not Telegram HTML`);
    } else if (tag[1] === "/") {
      if (open.at(-1) === name) open.pop();
      else issues.push(`</${name}> closes nothing open`);
    } else {
      open.push(name);
    }
    i = end;
  }
  if (open.length > 0) issues.push(`unclosed ${open.map((name) => `<${name}>`).join(" ")}`);
  return issues;
}

type Message = {
  text: string;
  kind: "text" | "caption";
  html: boolean;
  /** A copy of what a user wrote, sent back with their entities (the preview of /announce). */
  userEntities: boolean;
  payload: Record<string, unknown>;
};

type Button = { text?: unknown; callback_data?: unknown };

const buttonsOf = (payload: Record<string, unknown>): Button[] =>
  (
    (payload["reply_markup"] as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard ?? []
  ).flat();

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function messageOf({ method, payload }: SentCall): Message | null {
  if (TEXT_METHODS.has(method)) {
    return {
      text: stringOf(payload["text"]) ?? "",
      kind: "text",
      html: payload["parse_mode"] === "HTML",
      userEntities: payload["entities"] !== undefined,
      payload,
    };
  }
  // editMessageMedia carries the caption inside the media it puts in place.
  const holder =
    method === "editMessageMedia"
      ? (payload["media"] as Record<string, unknown> | undefined)
      : CAPTION_METHODS.has(method)
        ? payload
        : undefined;
  if (holder === undefined) return null;
  return {
    text: stringOf(holder["caption"]) ?? "",
    kind: "caption",
    html: holder["parse_mode"] === "HTML",
    userEntities: holder["caption_entities"] !== undefined,
    payload,
  };
}

function keyboardIssues(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const button of buttonsOf(payload)) {
    const label = stringOf(button.text) ?? "";
    if (label.trim() === "") issues.push("a button has no label");
    const data = stringOf(button.callback_data);
    if (data !== undefined && utf8ByteLength(data) > TG.CALLBACK_DATA_MAX_BYTES) {
      issues.push(`callback data "${data}" is over ${TG.CALLBACK_DATA_MAX_BYTES} bytes`);
    }
  }
  return issues;
}

/** The header of a screen opens on its name in bold (§4.5): `<b>👛 WALLETS · 2/5</b>`. */
const BOLD_TITLE = /^<b>.+?<\/b>/;

/**
 * What a message breaks of §4.5: a header that opens on the name of the screen in bold,
 * something above the keyboard besides the header, Telegram's limits (4096 characters, 1024
 * for a caption, 64 bytes of callback data, 200 characters of alert), Telegram HTML, link
 * previews disabled. Empty: the message follows the rules. No header names the network (D24).
 *
 * A message with buttons is a screen, and so is any HTML message. A plain message without
 * buttons is checked for its limits only: a notice (the warning of the sensitive-message
 * guard, the generic error, « Your data has been deleted. »), or a copy of what a user wrote
 * (the preview of /announce).
 */
export function screenIssues(call: SentCall): string[] {
  if (call.method === "answerCallbackQuery") {
    const alert = stringOf(call.payload["text"]) ?? "";
    return alert.length > TG.CALLBACK_ALERT_MAX_CHARS
      ? [`alert of ${alert.length} characters, over ${TG.CALLBACK_ALERT_MAX_CHARS}`]
      : [];
  }
  const message = messageOf(call);
  if (message === null) return keyboardIssues(call.payload);

  const issues = keyboardIssues(message.payload);
  const max = message.kind === "text" ? TG.MESSAGE_MAX_CHARS : TG.CAPTION_MAX_CHARS;
  const visible = message.html ? visibleText(message.text) : message.text;
  if (visible.length > max) issues.push(`${visible.length} characters, over ${max}`);
  if (message.userEntities) return issues;
  if (!message.html) {
    return buttonsOf(message.payload).length === 0
      ? issues
      : [...issues, 'buttons under a text without parse_mode "HTML": not built as a screen'];
  }
  issues.push(...htmlIssues(message.text));
  const [header = "", ...blocks] = message.text.split("\n\n");
  if (!BOLD_TITLE.test(header)) issues.push("no name of the screen in bold in the header");
  if (visibleText(blocks.join("\n\n")).trim() === "") {
    issues.push("nothing but the header above the keyboard");
  }
  const preview = message.payload["link_preview_options"] as { is_disabled?: unknown } | undefined;
  if (message.kind === "text" && preview?.is_disabled !== true) {
    issues.push("link previews are not disabled");
  }
  return issues;
}

/**
 * With `SCREENS_CATALOG_DIR` set (`pnpm screens:catalog`), appends a message a test sent to
 * `<dir>/<test file>.jsonl`: the review page of every screen (V1-46) is built from them.
 */
export function catalogScreen(call: SentCall, from: { test?: string; file?: string }): void {
  const dir = process.env["SCREENS_CATALOG_DIR"];
  if (dir === undefined || dir === "") return;
  // A Telegram id is a bigint, a picture is bytes or a grammY InputFile, whose toJSON throws:
  // written as text, never as the file.
  const readable = (value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Uint8Array || value?.constructor?.name === "InputFile") return "[file]";
    if (Array.isArray(value)) return value.map(readable);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, readable(inner)]));
  };
  try {
    mkdirSync(dir, { recursive: true });
    const entry = { test: from.test, method: call.method, payload: readable(call.payload) };
    appendFileSync(
      join(dir, `${basename(from.file ?? "unknown")}.jsonl`),
      `${JSON.stringify(entry)}\n`,
    );
  } catch {
    // The page is a review aid: a message it cannot write never fails the test that sent it.
  }
}
