import { en } from "@launchbot/shared";
import type { AiProviders } from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  fakeAiQuota,
  fakeDrafts,
  feed,
  testDraft,
  TEST_USER,
} from "../../test-harness.js";
import type { ApiReplies } from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { TOKEN_CB } from "./screens.js";

const CHAT_KEY = "777";
const OTTER = testDraft({
  id: "d1",
  name: "Moon Otter",
  symbol: "OTTR",
  description: "An otter who loves the stars.",
  imageFileId: "file-1",
  website: "https://moon.com",
});
const PICKLE = {
  name: "Cosmic Pickle",
  symbol: "PCKL",
  description: "A pickle who dreams of orbit.",
};
const COMING = en.token.ai.comingSoon;

beforeEach(resetRateLimits);

/** The bot with the draft of the mockup in the session of the simulation. */
function harness(
  options: {
    premium?: boolean;
    used?: number;
    providers?: AiProviders;
    replies?: ApiReplies;
  } = {},
) {
  const drafts = fakeDrafts({ rows: [OTTER] });
  const aiQuota = fakeAiQuota({ used: options.used ?? 12 });
  const h = botHarness({
    drafts,
    aiQuota,
    aiProviders: options.providers,
    replies: options.replies,
    data: { hasActivePremium: () => Promise.resolve(options.premium ?? false) },
  });
  const session: SessionData = { v: 1, tokenStep: { SIMULATION: { draftId: "d1" } } };
  h.prisma.sessions.set(CHAT_KEY, JSON.stringify(session));
  return {
    ...h,
    screen: h.api.screen,
    lastAlert: h.api.lastAlert,
    draft: () => drafts.rows.get("d1"),
    click: () => feed(h.bot, callbackUpdate(TOKEN_CB.ai("SIMULATION"))),
  };
}

describe("AI Generate (V1-17)", () => {
  it("shows the coming soon mention to everyone, and the quota line to Premium users only", async () => {
    const free = harness();
    await feed(free.bot, callbackUpdate(MENU.simulate));
    expect(free.screen().endsWith(`\n\n${COMING}`)).toBe(true);
    expect(free.screen()).not.toContain("AI generations today");

    const premium = harness({ premium: true, used: 13 });
    await feed(premium.bot, callbackUpdate(MENU.simulate));
    expect(premium.screen()).toContain(
      "└ ✈️ Telegram: —\n\n🤖 AI generations today: 13/50\n\n🤖 AI model coming soon",
    );
  });

  it("without Premium: the alert, the flag, nothing generated, no row", async () => {
    const h = harness();

    await h.click();

    expect(h.lastAlert()).toMatchObject({
      text: "🔒 AI Generate is a Premium feature.",
      show_alert: true,
    });
    expect(h.screen()).toContain(
      "└ ✈️ Telegram: —\n\n🔒 AI Generate: Premium only\n\n🤖 AI model coming soon",
    );
    expect(h.screen()).toContain("┌ Name: Moon Otter");
    expect(h.draft()).toMatchObject({ name: "Moon Otter", symbol: "OTTR" });
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(12);
  });

  it("reads the plan again on the click: a Premium that expired locks the button", async () => {
    const h = harness();
    let premium = true;
    h.data.hasActivePremium = () => Promise.resolve(premium);

    await feed(h.bot, callbackUpdate(MENU.simulate));
    expect(h.api.keyboard("editMessageText", -1)[0]?.[1]).toMatchObject({ text: "🤖 AI Generate" });

    premium = false;
    await h.click();

    expect(h.lastAlert()).toMatchObject({ text: "🔒 AI Generate is a Premium feature." });
    expect(h.api.keyboard("editMessageText", -1)[0]?.[1]).toMatchObject({ text: "🔒 AI Generate" });
  });

  it("with Premium and no provider: one TEXT row, the local token, image and links kept", async () => {
    const h = harness({ premium: true, used: 12 });

    await h.click();

    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(13);
    expect(h.aiQuota.logos).toEqual([]);
    const draft = h.draft();
    expect(draft?.name).not.toBe("Moon Otter");
    expect(draft?.symbol).not.toBe("OTTR");
    expect(draft).toMatchObject({ imageFileId: "file-1", website: "https://moon.com" });
    expect(h.screen()).toContain(`┌ Name: ${draft?.name}\n├ Ticker: $${draft?.symbol}`);
    expect(h.screen()).toContain(
      "├ 🌐 Website: moon.com\n├ 🐦 X: —\n└ ✈️ Telegram: —\n\n🤖 AI generations today: 13/50\n\n🤖 AI model coming soon",
    );
    expect(h.lastAlert()?.["text"]).toBeUndefined();
  });

  it("over the daily quota: the alert, the flag, no generation, no row", async () => {
    const h = harness({ premium: true, used: 50 });

    await h.click();

    expect(h.lastAlert()).toMatchObject({
      text: "You've used your 50 AI generations for today.",
      show_alert: true,
    });
    expect(h.screen()).toContain(
      "\n\n⚠️ AI Generate: daily limit reached (50/50). Resets at 00:00 UTC.\n\n🤖 AI model coming soon",
    );
    expect(h.draft()?.name).toBe("Moon Otter");
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(50);
  });

  it("over the rate limit: the alert, the flag, no row", async () => {
    const h = harness({ premium: true, used: 12 });
    for (let i = 0; i < 20; i++) consumeRateLimit(Number(TEST_USER.telegramId), "generate");

    await h.click();

    expect(String(h.lastAlert()?.["text"])).toMatch(/^⏳ Too many actions\. Try again in \d+ s\.$/);
    expect(h.screen()).toMatch(
      /⏳ Too many actions\. Try again in \d+ s\.\n\n🤖 AI model coming soon/,
    );
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(12);
  });

  it("with a text provider: its token, no coming soon mention, a Generating screen first", async () => {
    const providers: AiProviders = {
      text: { id: "fake", generateText: () => Promise.resolve(PICKLE) },
      logo: null,
    };
    const h = harness({ premium: true, providers });

    await h.click();

    const screens = h.api.of("editMessageText").map((call) => String(call.payload["text"]));
    expect(screens.at(-2)).toContain("🤖 Generating…");
    expect(h.screen()).toContain("┌ Name: Cosmic Pickle\n├ Ticker: $PCKL");
    expect(h.screen()).not.toContain(COMING);
    expect(h.draft()).toMatchObject({ ...PICKLE, imageFileId: "file-1" });
    // Answered before the provider ran, with nothing to say.
    expect(h.api.of("answerCallbackQuery")).toHaveLength(1);
    expect(h.lastAlert()?.["text"]).toBeUndefined();
  });

  it("with a failing text provider: the local fallback and its flag", async () => {
    const providers: AiProviders = {
      text: { id: "fake", generateText: () => Promise.reject(new Error("boom")) },
      logo: null,
    };
    const h = harness({ premium: true, providers });

    await h.click();

    expect(h.draft()?.name).not.toBe("Moon Otter");
    expect(h.screen().endsWith("\n\n⚠️ AI model unavailable: used the standard generator.")).toBe(
      true,
    );
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(13);
  });

  it("with a logo provider: the logo is sent to Telegram, deleted, and its file_id stored", async () => {
    const generateLogo = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const }),
    );
    const providers: AiProviders = {
      text: { id: "fake", generateText: () => Promise.resolve(PICKLE) },
      logo: { id: "fake-logo", generateLogo },
    };
    const h = harness({
      premium: true,
      providers,
      replies: {
        sendPhoto: { message_id: 900, photo: [{ file_id: "small" }, { file_id: "logo-big" }] },
      },
    });

    await h.click();

    expect(generateLogo).toHaveBeenCalledWith(PICKLE, expect.any(AbortSignal));
    expect(h.api.of("sendPhoto")).toHaveLength(1);
    expect(h.api.of("deleteMessage").at(-1)?.payload).toMatchObject({ message_id: 900 });
    expect(h.draft()).toMatchObject({ ...PICKLE, imageFileId: "logo-big" });
    expect(h.aiQuota.logos).toEqual([TEST_USER.id]);
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(13);
  });

  it("keeps the image when the logo provider fails", async () => {
    const providers: AiProviders = {
      text: { id: "fake", generateText: () => Promise.resolve(PICKLE) },
      logo: { id: "fake-logo", generateLogo: () => Promise.reject(new Error("no logo")) },
    };
    const h = harness({ premium: true, providers });

    await h.click();

    expect(h.api.of("sendPhoto")).toHaveLength(0);
    expect(h.draft()).toMatchObject({ ...PICKLE, imageFileId: "file-1" });
  });

  it("serves both flows: an AI click on the launch flow is a stale button until V1-37", async () => {
    const h = harness({ premium: true });

    await feed(h.bot, callbackUpdate(TOKEN_CB.ai("LAUNCH")));

    expect(h.lastAlert()?.["text"]).toBe(en.common.staleButton);
    expect(h.aiQuota.used.get(TEST_USER.id)).toBe(12);
  });
});
