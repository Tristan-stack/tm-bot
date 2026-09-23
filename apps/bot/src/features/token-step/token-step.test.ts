import {
  createUi,
  en,
  isCallbackDataSize,
  NAV_HOME,
  TOKEN_INPUT_TIMEOUT_MS,
} from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  fakeDrafts,
  feed,
  keyboardOf,
  messageUpdate,
  storedSession,
  testDraft,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { buildDevBuySoonScreen } from "../simulation/provisional.js";
import {
  buildEditChoiceScreen,
  buildFieldInputScreen,
  EMPTY_DRAFT,
  renderTokenStep,
  TOKEN_CB,
} from "./screens.js";
import type { TokenDraftView, TokenStepView } from "./screens.js";
import { imageFileIdOf } from "./token-step.js";

const ui = createUi("devnet");
const CHAT_KEY = "777";
/** On every Token screen until a text provider exists (V1-17). */
const COMING = en.token.ai.comingSoon;

/** The token of the mockup of §5, image added, no link. */
const OTTER: TokenDraftView = {
  name: "Moon Otter",
  symbol: "OTTR",
  description: "An otter who loves the stars.",
  imageFileId: "file-1",
  website: null,
  twitter: null,
  telegram: null,
};

const view = (overrides: Partial<TokenStepView> = {}): TokenStepView => ({
  flow: "SIMULATION",
  draft: OTTER,
  isPremium: false,
  backData: NAV_HOME,
  summaryLines: [],
  infos: [],
  flags: [],
  notes: [],
  ...overrides,
});

const HEADER_SIM = [
  "<b>📊 SIMULATION · STEP 1/3</b> · 🧪 Devnet",
  "▰▱▱",
  "Token › Dev buy › Recap",
].join("\n");

const BLOCK_OTTER = [
  "<b>🪙 TOKEN</b>",
  "┌ Name: Moon Otter",
  "├ Ticker: $OTTR",
  "├ Description: An otter who loves the stars.",
  "├ 🖼 Image: ✅ Added",
  "├ 🌐 Website: —",
  "├ 🐦 X: —",
  "└ ✈️ Telegram: —",
].join("\n");

beforeEach(resetRateLimits);

describe("renderTokenStep", () => {
  it("renders the mockup of §5 in SIMULATION", () => {
    const screen = renderTokenStep(ui, view());

    expect(screen.text).toBe([HEADER_SIM, en.token.description, BLOCK_OTTER].join("\n\n"));
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🎲 Generate", callback_data: "tok:gen:s" },
        { text: "🔒 AI Generate", callback_data: "tok:ai:s" },
      ],
      [{ text: "✏️ Edit", callback_data: "tok:ed:s" }],
      [
        { text: "🖼 Image", callback_data: "tok:in:s:img" },
        { text: "🌐 Website", callback_data: "tok:in:s:web" },
      ],
      [
        { text: "🐦 X", callback_data: "tok:in:s:x" },
        { text: "✈️ Telegram", callback_data: "tok:in:s:tg" },
      ],
      [
        { text: "⬅️ Back", callback_data: "nav:home" },
        { text: "➡️ Continue", callback_data: "tok:next:s" },
      ],
    ]);
  });

  it("renders step 3/4 of a launch with the summary before the block", () => {
    const summaryLines = ["👛 Wallet: Main · 4.200 SOL", "💰 Dev buy: 3 SOL"];
    const screen = renderTokenStep(ui, view({ flow: "LAUNCH", summaryLines }));

    expect(screen.text).toBe(
      [
        "<b>🚀 LAUNCH · STEP 3/4</b> · 🧪 Devnet\n▰▰▰▱\nWallet › Dev buy › Token › Recap",
        en.token.description,
        summaryLines.join("\n"),
        BLOCK_OTTER,
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)[0]).toEqual([
      { text: "🎲 Generate", callback_data: "tok:gen:l" },
      { text: "🔒 AI Generate", callback_data: "tok:ai:l" },
    ]);
  });

  it("shows — for every field of a new draft", () => {
    const { text } = renderTokenStep(ui, view({ draft: EMPTY_DRAFT }));

    expect(text).toContain(
      "┌ Name: —\n├ Ticker: —\n├ Description: —\n├ 🖼 Image: —\n├ 🌐 Website: —\n├ 🐦 X: —\n└ ✈️ Telegram: —",
    );
  });

  it("orders description, summary, block, infos, flags, then the notes above the keyboard", () => {
    const { text } = renderTokenStep(
      ui,
      view({
        summaryLines: ["SUMMARY"],
        infos: ["INFO"],
        flags: ["FLAG 1", undefined, "FLAG 2"],
        notes: ["NOTE"],
      }),
    );

    expect(text).toBe(
      [
        HEADER_SIM,
        en.token.description,
        "SUMMARY",
        BLOCK_OTTER,
        "INFO",
        "FLAG 1\nFLAG 2",
        "NOTE",
      ].join("\n\n"),
    );
  });

  it("unlocks the AI button with an active Premium", () => {
    expect(keyboardOf(renderTokenStep(ui, view({ isPremium: true })))[0]?.[1]).toEqual({
      text: "🤖 AI Generate",
      callback_data: "tok:ai:s",
    });
  });

  it("shows the links short and escapes user values", () => {
    const { text } = renderTokenStep(
      ui,
      view({
        draft: {
          ...OTTER,
          name: "<b>Tom</b> & Jerry",
          website: "https://moon.com/about",
          twitter: "https://x.com/moonotter",
          telegram: "https://t.me/moonotter",
        },
      }),
    );

    expect(text).toContain("┌ Name: &lt;b&gt;Tom&lt;/b&gt; &amp; Jerry");
    expect(text).toContain(
      "├ 🌐 Website: moon.com/about\n├ 🐦 X: @moonotter\n└ ✈️ Telegram: t.me/moonotter",
    );
  });

  it("keeps every callback data under 64 bytes", () => {
    for (const flow of ["SIMULATION", "LAUNCH"] as const) {
      const all = [
        TOKEN_CB.generate(flow),
        TOKEN_CB.ai(flow),
        TOKEN_CB.edit(flow),
        TOKEN_CB.editField(flow, "description"),
        TOKEN_CB.input(flow, "telegram"),
        TOKEN_CB.remove(flow, "website"),
        TOKEN_CB.cancel(flow),
        TOKEN_CB.next(flow),
      ];
      for (const data of all) expect(isCallbackDataSize(data)).toBe(true);
    }
  });
});

describe("edit and input screens", () => {
  it("offers the three fields and Cancel", () => {
    const screen = buildEditChoiceScreen(ui, "SIMULATION", OTTER);

    expect(screen.text).toBe(
      [
        HEADER_SIM,
        en.token.edit.description,
        "<b>🪙 TOKEN</b>\n┌ Name: Moon Otter\n├ Ticker: $OTTR\n└ Description: An otter who loves the stars.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "Name", callback_data: "tok:ed:s:n" },
        { text: "Ticker", callback_data: "tok:ed:s:t" },
        { text: "Description", callback_data: "tok:ed:s:d" },
      ],
      [{ text: "❌ Cancel", callback_data: "tok:cx:s" }],
    ]);
  });

  it("shows the current value, the rule and the error of the name input", () => {
    const screen = buildFieldInputScreen(ui, "SIMULATION", "name", OTTER, {
      flags: [en.token.errors.nameTooLong(36)],
    });

    expect(screen.text).toBe(
      [
        HEADER_SIM,
        "✏️ Send the new name.",
        "Current: Moon Otter\nRules: 1 to 32 bytes. Emojis count as several bytes.",
        "⚠️ Name too long: 36 bytes (max 32).",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "❌ Cancel", callback_data: "tok:cx:s" }]]);
  });

  it("shows the ticker with its $ and an empty field as —", () => {
    expect(buildFieldInputScreen(ui, "LAUNCH", "ticker", OTTER).text).toContain("Current: $OTTR");
    expect(buildFieldInputScreen(ui, "LAUNCH", "website", OTTER).text).toContain("Current: —");
    expect(buildFieldInputScreen(ui, "LAUNCH", "image", OTTER).text).toContain("Current: ✅ Added");
  });

  it("adds Remove only when an optional field is filled", () => {
    const filled = buildFieldInputScreen(ui, "SIMULATION", "image", OTTER);
    const empty = buildFieldInputScreen(ui, "SIMULATION", "website", OTTER);
    const name = buildFieldInputScreen(ui, "SIMULATION", "name", OTTER);

    expect(keyboardOf(filled)).toEqual([
      [
        { text: "🗑 Remove", callback_data: "tok:rm:s:img" },
        { text: "❌ Cancel", callback_data: "tok:cx:s" },
      ],
    ]);
    expect(keyboardOf(empty)).toEqual([[{ text: "❌ Cancel", callback_data: "tok:cx:s" }]]);
    expect(keyboardOf(name)).toEqual([[{ text: "❌ Cancel", callback_data: "tok:cx:s" }]]);
  });

  it("escapes the current value", () => {
    expect(
      buildFieldInputScreen(ui, "SIMULATION", "name", { ...OTTER, name: "<b>&" }).text,
    ).toContain("Current: &lt;b&gt;&amp;");
  });

  it("renders the provisional step 2 with Back to the Token screen and Menu", () => {
    const screen = buildDevBuySoonScreen(ui, { name: "Moon <Otter>", symbol: "OTTR" });

    expect(screen.text).toBe(
      [
        "<b>📊 SIMULATION · STEP 2/3</b> · 🧪 Devnet\n▰▰▱\nToken › Dev buy › Recap",
        "🪙 Moon &lt;Otter&gt; · $OTTR\nThe dev buy step is coming soon.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "⬅️ Back", callback_data: "sim:open" },
        { text: "🏠 Menu", callback_data: "nav:home" },
      ],
    ]);
  });
});

describe("imageFileIdOf", () => {
  const message = (fields: Record<string, unknown>) =>
    messageUpdate(fields).message as NonNullable<ReturnType<typeof messageUpdate>["message"]>;
  const size = (file_id: string) => ({ file_id, file_unique_id: file_id, width: 1, height: 1 });

  it("takes the largest size of a photo", () => {
    expect(imageFileIdOf(message({ photo: [size("small"), size("medium"), size("big")] }))).toBe(
      "big",
    );
  });

  it.each([
    ["a PNG file", { mime_type: "image/png", file_size: 1_000_000 }, "doc"],
    ["a WEBP file without a size", { mime_type: "image/webp" }, "doc"],
    ["a PDF", { mime_type: "application/pdf", file_size: 1_000 }, null],
    ["a 25 MB image", { mime_type: "image/jpeg", file_size: 25 * 1024 * 1024 }, null],
    ["a file without a type", { file_size: 10 }, null],
  ])("reads %s", (_label, document, expected) => {
    expect(
      imageFileIdOf(message({ document: { file_id: "doc", file_unique_id: "doc", ...document } })),
    ).toBe(expected);
  });

  it("refuses a text, a sticker and nothing", () => {
    expect(imageFileIdOf(message({ text: "hello" }))).toBeNull();
    expect(imageFileIdOf(message({ sticker: { file_id: "st" } }))).toBeNull();
    expect(imageFileIdOf(undefined)).toBeNull();
  });
});

describe("Simulate a Launch, provisional (V1-16)", () => {
  /** The bot with a draft already in the session of the flow, as after a first Generate. */
  function harness(options: Parameters<typeof botHarness>[0] & { draftId?: string } = {}) {
    const h = botHarness(options);
    if (options.draftId !== undefined) {
      const session: SessionData = {
        v: 1,
        tokenStep: { SIMULATION: { draftId: options.draftId } },
      };
      h.prisma.sessions.set(CHAT_KEY, JSON.stringify(session));
    }
    return { ...h, lastAlert: h.api.lastAlert, screen: h.api.screen };
  }

  it("opens the Token screen from the menu, in place, with an empty draft", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(MENU.simulate));

    expect(h.screen()).toContain(HEADER_SIM);
    expect(h.screen()).toContain("┌ Name: —\n├ Ticker: —");
    expect(h.drafts.rows.size).toBe(0);
  });

  it("Generate creates the draft, fills name, ticker and description, and keeps the rest", async () => {
    const drafts = fakeDrafts({
      rows: [testDraft({ id: "d1", imageFileId: "file-1", website: "https://moon.com" })],
    });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));

    const draft = drafts.rows.get("d1");
    expect(draft?.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(draft?.symbol).toMatch(/^[A-Z]{3,6}$/);
    expect(draft?.description).toMatch(/\.$/);
    expect(draft).toMatchObject({ imageFileId: "file-1", website: "https://moon.com" });
    expect(h.screen()).toContain(`┌ Name: ${draft?.name}\n├ Ticker: $${draft?.symbol}`);
    expect(h.screen()).toContain("├ 🖼 Image: ✅ Added\n├ 🌐 Website: moon.com");
  });

  it("creates the draft lazily on the first Generate and keeps its id in the session", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));
    const first = [...h.drafts.rows.values()][0];
    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));

    expect(h.drafts.rows.size).toBe(1);
    expect(storedSession(h.prisma)?.tokenStep).toEqual({ SIMULATION: { draftId: first?.id } });
    const second = h.drafts.rows.get(first?.id ?? "");
    expect(second?.name).not.toBe(first?.name);
    expect(second?.symbol).not.toBe(first?.symbol);
  });

  it("blocks Generate over its rate limit with the alert and the flag", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));
    const before = h.drafts.rows.get("d1")?.name;
    // The window of the action, filled directly: 20 clicks would trip the global limit first.
    for (let i = 0; i < 20; i++) consumeRateLimit(Number(TEST_USER.telegramId), "generate");

    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));

    expect(h.lastAlert()).toMatchObject({ show_alert: true });
    expect(String(h.lastAlert()?.["text"])).toMatch(/^⏳ Too many actions\. Try again in \d+ s\.$/);
    expect(h.screen()).toMatch(
      /⏳ Too many actions\. Try again in \d+ s\.\n\n🤖 AI model coming soon/,
    );
    expect(h.drafts.rows.get("d1")?.name).toBe(before);
  });

  it("Continue without a name and a ticker: the alert, the flag, and no step 2", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(TOKEN_CB.next("SIMULATION")));

    expect(h.lastAlert()).toMatchObject({ text: "Add a name and ticker first.", show_alert: true });
    expect(h.screen()).toContain(HEADER_SIM);
    expect(h.screen().endsWith(`\n\n⚠️ Missing: name, ticker\n\n${COMING}`)).toBe(true);
  });

  it("names the one missing field, keeps the flag, and drops it after Generate", async () => {
    const drafts = fakeDrafts({ rows: [testDraft({ id: "d1", name: "Moon Otter" })] });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(TOKEN_CB.next("SIMULATION")));
    expect(h.screen().endsWith(`\n\n⚠️ Missing: ticker\n\n${COMING}`)).toBe(true);

    // The flag stays on the next screen of the step (proposal).
    await feed(h.bot, callbackUpdate(TOKEN_CB.cancel("SIMULATION")));
    expect(h.screen().endsWith(`\n\n⚠️ Missing: ticker\n\n${COMING}`)).toBe(true);

    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));
    expect(h.screen()).not.toContain("Missing");
    expect(storedSession(h.prisma)?.tokenStep?.SIMULATION?.showMissing).toBeUndefined();
  });

  it("Continue with a name and a ticker shows the provisional step 2; Back returns", async () => {
    const drafts = fakeDrafts({
      rows: [testDraft({ id: "d1", name: "Moon Otter", symbol: "OTTR" })],
    });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(TOKEN_CB.next("SIMULATION")));
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 2/3</b>");
    expect(h.screen()).toContain("🪙 Moon Otter · $OTTR\nThe dev buy step is coming soon.");
    expect(h.api.of("answerCallbackQuery").at(-1)?.payload["text"]).toBeUndefined();

    await feed(h.bot, callbackUpdate(MENU.simulate));
    expect(h.screen()).toContain("┌ Name: Moon Otter\n├ Ticker: $OTTR");
  });

  it("Back is the menu itself: nav:home, the one Back every screen shares", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(MENU.simulate));

    expect(h.api.keyboard("editMessageText", -1).at(-1)?.[0]).toEqual({
      text: "⬅️ Back",
      callback_data: "nav:home",
    });
  });

  it("labels the AI button 🤖 with an active Premium", async () => {
    const h = harness({ data: { hasActivePremium: () => Promise.resolve(true) } });

    await feed(h.bot, callbackUpdate(MENU.simulate));

    expect(h.api.keyboard("editMessageText", -1)[0]?.[1]).toMatchObject({ text: "🤖 AI Generate" });
  });

  it("Edit opens the choice, then the input, which the session remembers", async () => {
    const drafts = fakeDrafts({ rows: [testDraft({ id: "d1", name: "Moon Otter" })] });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(TOKEN_CB.edit("SIMULATION")));
    expect(h.screen()).toContain(en.token.edit.description);

    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "name")));
    expect(h.screen()).toContain("✏️ Send the new name.\n\nCurrent: Moon Otter");
    expect(storedSession(h.prisma)?.pendingInput).toMatchObject({
      kind: "token_field",
      flow: "SIMULATION",
      field: "name",
    });
  });

  it("a refused input shows the error, writes nothing, and stays open", async () => {
    const drafts = fakeDrafts({ rows: [testDraft({ id: "d1", name: "Moon Otter" })] });
    const h = harness({ drafts, draftId: "d1" });
    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "name")));

    await feed(h.bot, textUpdate("a".repeat(33)));

    expect(h.api.of("deleteMessage")).toHaveLength(1);
    expect(h.screen()).toContain("Current: Moon Otter");
    expect(h.screen().endsWith("\n\n⚠️ Name too long: 33 bytes (max 32).")).toBe(true);
    expect(drafts.rows.get("d1")?.name).toBe("Moon Otter");
    expect(storedSession(h.prisma)?.pendingInput).toMatchObject({ field: "name" });
  });

  it("a valid input is written, normalized, and the Token screen comes back in place", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "ticker")));

    await feed(h.bot, textUpdate("$ottr"));

    const draft = [...h.drafts.rows.values()][0];
    expect(draft?.symbol).toBe("OTTR");
    expect(h.screen()).toContain("├ Ticker: $OTTR");
    expect(h.api.of("editMessageText").at(-1)?.payload["message_id"]).toBe(50);
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();
  });

  it("Cancel closes the input without a write", async () => {
    const drafts = fakeDrafts({ rows: [testDraft({ id: "d1", name: "Moon Otter" })] });
    const h = harness({ drafts, draftId: "d1" });
    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "description")));

    await feed(h.bot, callbackUpdate(TOKEN_CB.cancel("SIMULATION")));
    await feed(h.bot, textUpdate("A late description."));

    expect(h.screen()).toContain("┌ Name: Moon Otter");
    expect(drafts.rows.get("d1")?.description).toBeNull();
    expect(h.api.of("deleteMessage")).toHaveLength(0);
  });

  it("a photo during a text input is refused with the text rule", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "name")));

    await feed(h.bot, messageUpdate({ photo: [{ file_id: "p", file_unique_id: "p" }] }));

    expect(h.screen().endsWith("\n\n⚠️ Send the value as a text message.")).toBe(true);
    expect(h.drafts.rows.size).toBe(0);
  });

  it("links are normalized, then offer Remove, which clears them", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "website")));

    await feed(h.bot, textUpdate("moon.com"));
    expect(h.screen().endsWith("\n\n⚠️ Invalid link. It must start with https://")).toBe(true);

    await feed(h.bot, textUpdate("HTTPS://Moon.com/"));
    const draft = [...h.drafts.rows.values()][0];
    expect(draft?.website).toBe("https://moon.com");
    expect(h.screen()).toContain("├ 🌐 Website: moon.com");

    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "x")));
    await feed(h.bot, textUpdate("@MoonOtter"));
    expect(h.drafts.rows.get(draft?.id ?? "")?.twitter).toBe("https://x.com/MoonOtter");

    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "telegram")));
    await feed(h.bot, textUpdate("t.me/moonotter"));
    expect(h.drafts.rows.get(draft?.id ?? "")?.telegram).toBe("https://t.me/moonotter");
    expect(h.screen()).toContain("├ 🐦 X: @MoonOtter\n└ ✈️ Telegram: t.me/moonotter");

    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "website")));
    expect(h.api.keyboard("editMessageText", -1)[0]?.[0]).toMatchObject({ text: "🗑 Remove" });
    await feed(h.bot, callbackUpdate(TOKEN_CB.remove("SIMULATION", "website")));
    expect(h.drafts.rows.get(draft?.id ?? "")?.website).toBeNull();
    expect(h.screen()).toContain("├ 🌐 Website: —");
  });

  it("the image input takes the largest photo size, or an image file, and refuses the rest", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "image")));

    await feed(h.bot, textUpdate("here is my logo"));
    expect(
      h.screen().endsWith("\n\n⚠️ Send a photo or an image file (JPG, PNG or WEBP, 20 MB max)."),
    ).toBe(true);

    await feed(
      h.bot,
      messageUpdate({
        document: { file_id: "pdf", file_unique_id: "pdf", mime_type: "application/pdf" },
      }),
    );
    expect(h.drafts.rows.size).toBe(0);

    await feed(
      h.bot,
      messageUpdate({
        photo: [
          { file_id: "small", file_unique_id: "s" },
          { file_id: "big", file_unique_id: "b" },
        ],
      }),
    );
    const draft = [...h.drafts.rows.values()][0];
    expect(draft?.imageFileId).toBe("big");
    expect(h.screen()).toContain("├ 🖼 Image: ✅ Added");

    await feed(h.bot, callbackUpdate(TOKEN_CB.input("SIMULATION", "image")));
    await feed(
      h.bot,
      messageUpdate({
        document: { file_id: "png", file_unique_id: "png", mime_type: "image/png", file_size: 5 },
      }),
    );
    expect(h.drafts.rows.get(draft?.id ?? "")?.imageFileId).toBe("png");
  });

  describe("an input left open", () => {
    afterEach(() => vi.useRealTimers());

    it("expires after 10 minutes: the Token screen says so and nothing is written", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const h = harness();
      await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "name")));

      vi.setSystemTime(Date.now() + TOKEN_INPUT_TIMEOUT_MS + 1);
      await feed(h.bot, textUpdate("Moon Otter"));

      expect(h.screen()).toContain("┌ Name: —");
      expect(h.screen().endsWith(`\n\n${en.token.inputExpired}\n\n${COMING}`)).toBe(true);
      expect(h.drafts.rows.size).toBe(0);
    });
  });

  it("edits a copy when a Simulation references the draft", async () => {
    const drafts = fakeDrafts({
      rows: [testDraft({ id: "d1", name: "Moon Otter", symbol: "OTTR" })],
      referenced: ["d1"],
    });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(TOKEN_CB.generate("SIMULATION")));

    expect(drafts.rows.get("d1")).toMatchObject({ name: "Moon Otter", symbol: "OTTR" });
    expect(drafts.rows.size).toBe(2);
    expect(storedSession(h.prisma)?.tokenStep?.SIMULATION?.draftId).toBe("d2");
    expect(drafts.rows.get("d2")?.name).not.toBe("Moon Otter");
  });

  it("never shows nor edits the draft of another user", async () => {
    const drafts = fakeDrafts({
      rows: [testDraft({ id: "d1", userId: "someone-else", name: "Theirs", symbol: "THR" })],
    });
    const h = harness({ drafts, draftId: "d1" });

    await feed(h.bot, callbackUpdate(MENU.simulate));
    expect(h.screen()).toContain("┌ Name: —");

    await feed(h.bot, callbackUpdate(TOKEN_CB.editField("SIMULATION", "name")));
    await feed(h.bot, textUpdate("Mine"));

    expect(drafts.rows.get("d1")).toMatchObject({ userId: "someone-else", name: "Theirs" });
    expect(drafts.rows.get("d2")).toMatchObject({ userId: TEST_USER.id, name: "Mine" });
  });

  it("answers an old or unknown button of the step with the stale toast", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate("tok:zzz:s"));
    await feed(h.bot, callbackUpdate("tok:gen:l"));

    expect(h.api.of("answerCallbackQuery").map((call) => call.payload["text"])).toEqual([
      en.common.staleButton,
      en.common.staleButton,
    ]);
  });
});
