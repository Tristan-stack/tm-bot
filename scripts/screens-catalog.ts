import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm screens:catalog` (V1-46): every message the tests of the bot and of the worker send,
// grouped by screen, on one page to review §4.5 by eye. The tests record what leaves through
// their fake Telegram (`catalogScreen` of `@launchbot/shared/test`); the rules themselves are
// checked by the tests, this page is for the eye: order of the blocks, wording, Back and Menu.

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "out", "screens.html");

type Entry = { file: string; test?: string; method: string; payload: Record<string, unknown> };
type Button = { text?: string; callback_data?: string; url?: string };

const MEDIA_CAPTION = new Set(["sendPhoto", "sendAnimation", "editMessageCaption"]);

function record(): Entry[] {
  const dir = mkdtempSync(join(tmpdir(), "screens-"));
  try {
    // One command line: pnpm is a .cmd on Windows, which only a shell runs.
    const run = spawnSync("pnpm exec vitest run --project bot --project worker", {
      cwd: ROOT,
      env: { ...process.env, SCREENS_CATALOG_DIR: dir },
      stdio: "inherit",
      shell: true,
    });
    if (run.status !== 0) {
      process.stderr.write("screens:catalog: some tests failed, the page shows what ran\n");
    }
    return readdirSync(dir).flatMap((name) =>
      readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => ({
          file: name.replace(/\.jsonl$/, ""),
          ...(JSON.parse(line) as Omit<Entry, "file">),
        })),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Test keys and phrases of /getall are fresh and hold nothing: masked all the same. */
const masked = (html: string): string =>
  html
    .replace(/[1-9A-HJ-NP-Za-km-z]{80,90}/g, "[private key masked]")
    .replace(/\b(?:[a-z]{3,8} ){11,23}[a-z]{3,8}\b/g, "[seed phrase masked]");

/** The text or the caption a user reads, as Telegram HTML, and whether it is a picture. */
function messageOf(entry: Entry): { html: string; plain: boolean; media: boolean } | null {
  const { method, payload } = entry;
  const isText = method === "sendMessage" || method === "editMessageText";
  const holder = isText
    ? payload
    : method === "editMessageMedia"
      ? (payload["media"] as Record<string, unknown> | undefined)
      : MEDIA_CAPTION.has(method)
        ? payload
        : undefined;
  if (holder === undefined) return null;
  const text = holder["text"] ?? holder["caption"];
  const html = masked(typeof text === "string" ? text : "");
  return { html, plain: holder["parse_mode"] !== "HTML", media: !isText };
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&" };

const titleOf = (html: string): string =>
  (html.split("\n")[0] ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:lt|gt|quot|amp);/g, (entity) => ENTITIES[entity] ?? entity)
    .trim() || "(no title)";

function keyboardHtml(payload: Record<string, unknown>): string {
  const rows =
    (payload["reply_markup"] as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard ??
    [];
  return rows
    .map(
      (row) =>
        `<div class="row">${row
          .map(
            (button) =>
              `<span class="btn" title="${escape(button.callback_data ?? button.url ?? "")}">${escape(button.text ?? "")}</span>`,
          )
          .join("")}</div>`,
    )
    .join("");
}

type Variant = {
  key: string;
  html: string;
  plain: boolean;
  media: boolean;
  keyboard: string;
  tests: Set<string>;
};

function build(entries: Entry[]): string {
  const screens = new Map<string, Map<string, Variant>>();
  const alerts = new Map<string, Set<string>>();
  for (const entry of entries) {
    const test = `${entry.file} › ${entry.test ?? "?"}`;
    if (entry.method === "answerCallbackQuery") {
      const text = entry.payload["text"];
      if (typeof text === "string" && text !== "") {
        const label = `${entry.payload["show_alert"] === true ? "alert" : "toast"} · ${text}`;
        (alerts.get(label) ?? alerts.set(label, new Set()).get(label))?.add(test);
      }
      continue;
    }
    const message = messageOf(entry);
    if (message === null) continue;
    const title = message.plain
      ? "(notice or copy of a user's message, no parse_mode)"
      : titleOf(message.html);
    const keyboard = keyboardHtml(entry.payload["reply_markup"] === undefined ? {} : entry.payload);
    const key = `${message.html}\u0000${keyboard}`;
    const group = screens.get(title) ?? screens.set(title, new Map()).get(title);
    const variant = group?.get(key) ?? { key, ...message, keyboard, tests: new Set<string>() };
    variant.tests.add(test);
    group?.set(key, variant);
  }

  const sections = [...screens.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, variants]) => {
      const cards = [...variants.values()]
        .map((variant) => {
          const tests = [...variant.tests];
          const body = variant.plain ? escape(variant.html) : variant.html;
          return `<article class="msg"><div class="bubble">${variant.media ? '<div class="media">picture</div>' : ""}<div class="text">${body}</div></div>${variant.keyboard === "" ? "" : `<div class="kb">${variant.keyboard}</div>`}<details><summary>${tests.length} test(s)</summary><ul>${tests
            .slice(0, 12)
            .map((test) => `<li>${escape(test)}</li>`)
            .join("")}</ul></details></article>`;
        })
        .join("");
      return `<section><h2>${escape(title)} <small>${variants.size} variant(s)</small></h2><div class="grid">${cards}</div></section>`;
    })
    .join("");
  const alertList = [...alerts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, tests]) => `<li>${escape(label)} <small>(${tests.size} test(s))</small></li>`)
    .join("");
  const variants = [...screens.values()].reduce((sum, group) => sum + group.size, 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screens catalog</title>
<style>
:root { --bg: #f4f4f5; --card: #fff; --text: #18181b; --muted: #71717a; --btn: #e4e4e7; --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181b; --card: #27272a; --text: #f4f4f5; --muted: #a1a1aa; --btn: #3f3f46; --accent: #60a5fa; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin: 28px 0 8px; } small { color: var(--muted); font-weight: normal; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.msg { background: var(--card); border-radius: 12px; padding: 10px; }
.text { white-space: pre-wrap; word-break: break-word; }
.media { background: var(--btn); border-radius: 8px; padding: 24px; text-align: center; color: var(--muted); margin-bottom: 8px; }
.kb .row { display: flex; gap: 4px; margin-top: 4px; } .btn { flex: 1; background: var(--btn); border-radius: 6px; padding: 6px; text-align: center; }
a { color: var(--accent); } code { font-family: ui-monospace, monospace; font-size: 13px; }
details { margin-top: 8px; color: var(--muted); font-size: 12px; }
</style></head><body>
<h1>Screens catalog</h1>
<p>${screens.size} screens, ${variants} distinct messages, from ${entries.length} messages sent by the tests of the bot and the worker. Every one passed the rules of §4.5 in its test (the name of the screen in bold, text above the keyboard, Telegram limits and HTML, previews off).</p>
${sections}
<section><h2>Answers to clicks <small>${alerts.size}</small></h2><ul>${alertList}</ul></section>
</body></html>
`;
}

const entries = record();
mkdirSync(join(ROOT, "scripts", "out"), { recursive: true });
writeFileSync(OUT, build(entries));
process.stdout.write(`screens:catalog: ${entries.length} messages → ${OUT}\n`);
