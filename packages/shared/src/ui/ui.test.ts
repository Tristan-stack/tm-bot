import { describe, expect, it } from "vitest";
import { encodeCallback, NAV_HOME } from "../callback.js";
import { TG } from "../constants.js";
import { en } from "../i18n/en.js";
import { flowHeader, screenHeader } from "./header.js";
import {
  a,
  b,
  cbBtn,
  code,
  cancelBtn,
  createUi,
  escapeHtml,
  navRow,
  renderInputScreen,
  renderScreen,
  ScreenTooLongError,
  tree,
  urlBtn,
  webAppBtn,
} from "./index.js";

const badge = "🧪 Devnet";
const keyboard = [navRow(NAV_HOME)];

describe("tree", () => {
  it("draws a bold title and one branch per line", () => {
    expect(tree("👤 ACCOUNT", ["@username", "🆔 1", "👛 No wallet yet"])).toBe(
      "<b>👤 ACCOUNT</b>\n┌ @username\n├ 🆔 1\n└ 👛 No wallet yet",
    );
  });

  it("closes a single line", () => {
    expect(tree("TITLE", ["only"])).toBe("<b>TITLE</b>\n└ only");
  });

  it("draws the branches alone without a title", () => {
    expect(tree(null, ["Main", "Test"])).toBe("┌ Main\n└ Test");
  });
});

describe("html", () => {
  it("escapes the four characters Telegram parses", () => {
    expect(escapeHtml(`<b>"Tom & Jerry"</b>`)).toBe(
      "&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;",
    );
  });

  it("escapes the arguments of every helper", () => {
    expect(b("<b>Moon</b>")).toBe("<b>&lt;b&gt;Moon&lt;/b&gt;</b>");
    expect(code("1 < 2")).toBe("<code>1 &lt; 2</code>");
    expect(a("R&D", 'https://example.com/?a=1&b="2"')).toBe(
      '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">R&amp;D</a>',
    );
  });
});

describe("screenHeader", () => {
  it("writes the title in bold, then the badge", () => {
    expect(screenHeader("🚀 LAUNCH BOT", undefined, badge)).toBe(
      "<b>🚀 LAUNCH BOT</b> · 🧪 Devnet",
    );
    expect(screenHeader("👛 WALLETS", "2/5", badge)).toBe("<b>👛 WALLETS · 2/5</b> · 🧪 Devnet");
  });

  it("drops the badge on a cluster without one", () => {
    expect(screenHeader("🚀 LAUNCH BOT", undefined, null)).toBe("<b>🚀 LAUNCH BOT</b>");
  });
});

describe("flowHeader", () => {
  it.each([
    [1, "▰▱▱"],
    [2, "▰▰▱"],
    [3, "▰▰▰"],
  ])("renders SIMULATION step %d/3", (step, bar) => {
    expect(flowHeader("SIMULATION", step, badge)).toBe(
      `<b>📊 SIMULATION · STEP ${step}/3</b> · 🧪 Devnet\n${bar}\nToken › Dev buy › Recap`,
    );
  });

  it.each([
    [1, "▰▱▱▱"],
    [2, "▰▰▱▱"],
    [4, "▰▰▰▰"],
  ])("renders LAUNCH step %d/4", (step, bar) => {
    expect(flowHeader("LAUNCH", step, badge)).toBe(
      `<b>🚀 LAUNCH · STEP ${step}/4</b> · 🧪 Devnet\n${bar}\nWallet › Dev buy › Token › Recap`,
    );
  });

  it.each([0, 4, -1, 1.5, Number.NaN])("rejects step %d of SIMULATION", (step) => {
    expect(() => flowHeader("SIMULATION", step, badge)).toThrow(RangeError);
  });
});

describe("createUi", () => {
  it("binds the headers and explorer links to the cluster", () => {
    const ui = createUi("devnet");

    expect(ui.screenHeader("👛 WALLETS", "2/5")).toBe("<b>👛 WALLETS · 2/5</b> · 🧪 Devnet");
    expect(ui.screenHeader("🚀 LAUNCH BOT")).toBe("<b>🚀 LAUNCH BOT</b> · 🧪 Devnet");
    expect(ui.flowHeader({ flow: "LAUNCH", step: 2 })).toContain("STEP 2/4</b> · 🧪 Devnet");
    expect(ui.explorerTxUrl("SIG")).toBe("https://explorer.solana.com/tx/SIG?cluster=devnet");
    expect(ui.config.networkName).toBe("Devnet");
  });

  it("refuses a cluster V1 does not define", () => {
    expect(() => createUi("mainnet-beta")).toThrow(/devnet only/);
  });
});

describe("renderScreen", () => {
  const header = screenHeader("👛 WALLETS", undefined, badge);

  it("orders the blocks, separated by an empty line", () => {
    const screen = renderScreen({
      header,
      description: "Manage your wallets.",
      info: ["┌ Main · 2.500 SOL", "└ Sniper · 1.750 SOL"],
      flags: ["⚠️ Sniper: Insufficient funds (0.650 SOL missing)"],
      footer: en.common.updated("14:32 UTC"),
      keyboard,
    });

    expect(screen.text).toBe(
      [
        "<b>👛 WALLETS</b> · 🧪 Devnet",
        "Manage your wallets.",
        "┌ Main · 2.500 SOL\n└ Sniper · 1.750 SOL",
        "⚠️ Sniper: Insufficient funds (0.650 SOL missing)",
        "🕒 Updated 14:32 UTC",
      ].join("\n\n"),
    );
  });

  it("sends HTML with link previews disabled and the raw keyboard", () => {
    const screen = renderScreen({ header, description: "Text", keyboard });

    expect(screen.parse_mode).toBe("HTML");
    expect(screen.link_preview_options).toEqual({ is_disabled: true });
    expect(screen.reply_markup).toEqual({
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: "nav:home" }]],
    });
  });

  it("leaves out empty blocks", () => {
    const screen = renderScreen({
      header,
      description: ["", "  "],
      info: "State",
      flags: [],
      footer: "",
      keyboard,
    });

    expect(screen.text).toBe("<b>👛 WALLETS</b> · 🧪 Devnet\n\nState");
  });

  it("puts the summary before the description on request (Dev buy, §6)", () => {
    const screen = renderScreen({
      header: flowHeader("SIMULATION", 2, badge),
      description: "How much SOL should the dev buy at launch?",
      info: [`🪙 ${escapeHtml("Moon Otter")} · $OTTR`, "💰 Dev buy: not selected yet"],
      flags: ["⚠️ Flag"],
      order: ["info", "description"],
      keyboard,
    });

    expect(screen.text).toBe(
      [
        "<b>📊 SIMULATION · STEP 2/3</b> · 🧪 Devnet\n▰▰▱\nToken › Dev buy › Recap",
        "🪙 Moon Otter · $OTTR\n💰 Dev buy: not selected yet",
        "How much SOL should the dev buy at launch?",
        "⚠️ Flag",
      ].join("\n\n"),
    );
  });

  it("refuses a screen with neither description nor info", () => {
    expect(() => renderScreen({ header, keyboard })).toThrow(/description or info/);
    expect(() =>
      renderScreen({ header, description: " ", info: [], flags: ["⚠️"], keyboard }),
    ).toThrow(/description or info/);
  });

  it("keeps a user value escaped", () => {
    const screen = renderScreen({ header, info: `Name: ${b("<b>x</b> & co")}`, keyboard });

    expect(screen.text).toContain("Name: <b>&lt;b&gt;x&lt;/b&gt; &amp; co</b>");
  });

  it("throws ScreenTooLongError above 4096 characters", () => {
    const fits = "x".repeat(TG.MESSAGE_MAX_CHARS - "H\n\n".length);

    expect(renderScreen({ header: "H", description: fits, keyboard }).text).toHaveLength(4096);
    expect(() => renderScreen({ header: "H", description: `${fits}x`, keyboard })).toThrow(
      ScreenTooLongError,
    );
  });
});

describe("renderInputScreen", () => {
  const cancel = [[cancelBtn(encodeCallback("tok", "cancel"))]];
  const base = {
    header: "<b>✏️ NAME</b>",
    prompt: "Send the token name.",
    rules: ["32 bytes max"],
  };

  it("shows the prompt, the escaped current value and the rules", () => {
    const screen = renderInputScreen({ ...base, current: "Moon <Otter>", keyboard: cancel });

    expect(screen.text).toBe(
      "<b>✏️ NAME</b>\n\nSend the token name.\n\nCurrent: Moon &lt;Otter&gt;\n32 bytes max",
    );
  });

  it("shows a dash for an empty field, and no line when there is no current value", () => {
    expect(renderInputScreen({ ...base, current: null, keyboard: cancel }).text).toContain(
      "Current: —\n",
    );
    expect(renderInputScreen({ ...base, keyboard: cancel }).text).not.toContain("Current");
  });

  it("refuses an input screen without Cancel", () => {
    expect(() => renderInputScreen({ ...base, keyboard })).toThrow(/Cancel/);
    expect(() => renderInputScreen({ ...base, keyboard: [] })).toThrow(/Cancel/);
  });

  it("writes what was wrong with the last input under the rules", () => {
    const screen = renderInputScreen({
      ...base,
      current: "Main",
      flags: ["⚠️ Too long: 41 characters (32 max)."],
      keyboard: cancel,
    });

    expect(screen.text).toBe(
      "<b>✏️ NAME</b>\n\nSend the token name.\n\nCurrent: Main\n32 bytes max\n\n⚠️ Too long: 41 characters (32 max).",
    );
  });
});

describe("buttons", () => {
  it("builds raw Bot API buttons", () => {
    expect(cbBtn("Delete", encodeCallback("wal", "del", "abc"))).toEqual({
      text: "Delete",
      callback_data: "wal:del:abc",
    });
    expect(urlBtn("Explorer", "https://explorer.solana.com")).toEqual({
      text: "Explorer",
      url: "https://explorer.solana.com",
    });
    expect(webAppBtn("Terms", "https://app.example.com/terms")).toEqual({
      text: "Terms",
      web_app: { url: "https://app.example.com/terms" },
    });
  });

  it("only accepts callback data built by encodeCallback (checked by tsc)", () => {
    // @ts-expect-error a hand-typed string is not CallbackData
    cbBtn("Delete", "wal:del:abc");
    // @ts-expect-error a hand-typed string is not CallbackData
    navRow("wal:list");
    // @ts-expect-error a hand-typed string is not CallbackData
    cancelBtn("tok:cancel");
    // The size is checked where the data is built.
    expect(() => cbBtn("Too long", encodeCallback("wal", "del", "x".repeat(60)))).toThrow(
      /64 bytes/,
    );
  });

  it("builds the Back / Menu row", () => {
    expect(navRow(encodeCallback("wal", "list"))).toEqual([
      { text: "⬅️ Back", callback_data: "wal:list" },
    ]);
    expect(navRow(encodeCallback("wal", "list"), { menu: true })).toEqual([
      { text: "⬅️ Back", callback_data: "wal:list" },
      { text: "🏠 Menu", callback_data: "nav:home" },
    ]);
  });
});
