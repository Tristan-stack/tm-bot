import { describe, expect, it } from "vitest";
import { encodeCallback } from "../callback.js";
import { renderInputScreen, renderScreen, cbBtn } from "../ui/screen.js";
import { createUi } from "../ui/index.js";
import { en } from "../i18n/en.js";
import { htmlIssues, screenIssues, visibleText } from "./screen-rules.js";

const ui = createUi("devnet");
const OK = encodeCallback("nav", "home");

const screen = (description: string) =>
  renderScreen({
    header: ui.screenHeader("👛 WALLETS"),
    description,
    keyboard: [[cbBtn("🏠 Menu", OK)]],
  });

const sent = (payload: Record<string, unknown>, method = "sendMessage") => ({ method, payload });

describe("screenIssues", () => {
  it("accepts the screens of renderScreen and renderInputScreen", () => {
    const input = renderInputScreen({
      header: ui.flowHeader({ flow: "WITHDRAW", step: 1 }),
      prompt: "Send the address.",
      rules: ["A Solana address."],
      keyboard: [[cbBtn(en.btn.cancel, OK)]],
    });

    expect(screenIssues(sent(screen("Your wallets.")))).toEqual([]);
    expect(screenIssues(sent({ ...input, chat_id: 1 }))).toEqual([]);
  });

  it("names every rule a message breaks", () => {
    const issues = screenIssues(
      sent({
        text: `👛 WALLETS\n\n<x>${"a".repeat(4096)}`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: " ", callback_data: `nav:${"a".repeat(64)}` }]],
        },
      }),
    );

    expect(issues).toEqual([
      "a button has no label",
      `callback data "nav:${"a".repeat(64)}" is over 64 bytes`,
      "4108 characters, over 4096",
      "tag <x> is not Telegram HTML",
      "no name of the screen in bold in the header",
      "link previews are not disabled",
    ]);
  });

  it("wants the name of the screen in bold at the top, and no network in it (D24)", () => {
    expect(ui.screenHeader("👛 WALLETS", "2/5")).toBe("<b>👛 WALLETS · 2/5</b>");
    expect(ui.flowHeader({ flow: "WITHDRAW", step: 1 }).split("\n")[0]).toBe(
      "<b>📤 WITHDRAW · STEP 1/3</b>",
    );
  });

  it("refuses a header alone, and buttons under a text that is not HTML", () => {
    const header = { text: ui.screenHeader("👛 WALLETS"), parse_mode: "HTML" };
    const keyboard = {
      reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: OK }]] },
    };

    expect(screenIssues(sent(header))).toContain("nothing but the header above the keyboard");
    expect(screenIssues(sent({ text: "Hello", ...keyboard }))).toEqual([
      'buttons under a text without parse_mode "HTML": not built as a screen',
    ]);
  });

  it("checks a plain notice without buttons for its limits only", () => {
    expect(screenIssues(sent({ text: "Your data has been deleted." }))).toEqual([]);
    expect(screenIssues(sent({ text: "a".repeat(4097) }))).toEqual(["4097 characters, over 4096"]);
  });

  it("checks the caption of a media, inside the media of editMessageMedia", () => {
    const caption = `${ui.screenHeader("📊 SIMULATION")}\n\nDEMO`;
    const media = { type: "photo", caption: `${caption}${"a".repeat(1024)}`, parse_mode: "HTML" };

    expect(screenIssues(sent({ caption, parse_mode: "HTML" }, "sendPhoto"))).toEqual([]);
    expect(screenIssues(sent({ media }, "editMessageMedia"))).toEqual([
      "1043 characters, over 1024",
    ]);
  });

  it("checks a copy of the user's own message (the preview of /announce) for its limits only", () => {
    expect(screenIssues(sent({ text: "gm <x>", entities: [] }))).toEqual([]);
    expect(screenIssues(sent({ caption: "gm", caption_entities: [] }, "sendPhoto"))).toEqual([]);
  });

  it("measures the visible text, and alerts at 200 characters", () => {
    // 20 000 characters of HTML, 4 000 on the screen: renderScreen would refuse it, Telegram not.
    const text = `${ui.screenHeader("👛 WALLETS")}\n\n${"&amp;".repeat(4000)}`;
    const previews = { link_preview_options: { is_disabled: true } };

    expect(screenIssues(sent({ text, parse_mode: "HTML", ...previews }))).toEqual([]);
    expect(screenIssues(sent({ text: "a".repeat(201) }, "answerCallbackQuery"))).toEqual([
      "alert of 201 characters, over 200",
    ]);
    expect(screenIssues(sent({ text: "a".repeat(200) }, "answerCallbackQuery"))).toEqual([]);
  });
});

describe("htmlIssues", () => {
  it.each([
    ['<b>bold</b> <i>it</i> <a href="https://x.com/?a=1&amp;b=2">x</a>', []],
    ["<code>a</code><pre>b</pre><blockquote>c</blockquote>", []],
    ["1 &lt; 2 &amp;&amp; 3 &gt; 2 &quot;q&quot; &#128640; &#x1F680;", []],
    ["Tom & Jerry", ['bare "&" at 4: escape it as &amp;']],
    ["a > b", ['bare ">" at 2: escape it as &gt;']],
    ["a < b", ['bare "<" at 2: escape it as &lt;']],
    ["<b>x</i>", ["</i> closes nothing open", "unclosed <b>"]],
    ["<b>never closed", ["unclosed <b>"]],
    [
      "<script>x</script>",
      ["tag <script> is not Telegram HTML", "tag </script> is not Telegram HTML"],
    ],
  ])("%j → %j", (html, expected) => {
    expect(htmlIssues(html)).toEqual(expected);
  });
});

describe("visibleText", () => {
  it("drops the tags and decodes the entities", () => {
    expect(
      visibleText('<b>&lt;b&gt;x&lt;/b&gt;</b> &amp; <a href="u">&quot;y&quot;</a> &#128640;'),
    ).toBe('<b>x</b> & "y" 🚀');
  });
});
