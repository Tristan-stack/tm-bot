import { en, NAV_HOME, RATE_LIMITS, SIM_END_HOLD_MS, simConfigSchema } from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionData } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  fakeDrafts,
  fakeScheduler,
  feed,
  FIRST_MESSAGE_ID,
  testDraft,
  TEST_USER,
} from "../../test-harness.js";
import { SIM_CB } from "./screens.js";

const CHAT_KEY = "777";
const OTTER = testDraft({ id: "d1", name: "Moon Otter", symbol: "OTTR", imageFileId: "file-1" });

function harness(options: { maxActive?: number } = {}) {
  const clock = fakeScheduler();
  const h = botHarness({
    drafts: fakeDrafts({ rows: [OTTER] }),
    simRunner: { scheduler: clock.scheduler, maxActive: options.maxActive ?? 20 },
  });
  const session: SessionData = { v: 1, tokenStep: { SIMULATION: { draftId: "d1" } } };
  h.prisma.sessions.set(CHAT_KEY, JSON.stringify(session));
  const photos = () => h.api.of("sendPhoto");
  const edits = () => h.api.of("editMessageMedia");
  /** The caption of a sent photo, or of an edited media (where Telegram nests it). */
  const caption = (call: { payload: Record<string, unknown> }) =>
    String(
      (call.payload["media"] as { caption?: string } | undefined)?.caption ??
        call.payload["caption"],
    );
  /** The recap of a 5 SOL bundle, then Start simulation on it. */
  const start = async () => {
    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));
    await feed(h.bot, callbackUpdate(SIM_CB.go("s1")));
  };
  return { ...h, ...clock, photos, edits, caption, start, lastAlert: h.api.lastAlert };
}

beforeEach(resetRateLimits);

describe("Start simulation (V1-26)", () => {
  it("sends the protected photo with its caption and buttons, and disarms the recap", async () => {
    const h = harness();

    await h.start();

    const photo = h.photos()[0];
    expect(photo?.payload).toMatchObject({
      chat_id: 777,
      protect_content: true,
      parse_mode: "HTML",
    });
    expect(h.caption(photo!)).toContain("<b>📊 SIMULATION</b> · 🧪 Devnet");
    expect(h.caption(photo!)).toContain(en.sim.demoBanner);
    expect(h.caption(photo!)).toContain("🪙 Moon Otter · $OTTR");
    expect(h.caption(photo!)).toContain("⏱ 0:00 / 3:00 · Speed x2");
    expect(h.caption(photo!)).toContain("💼 You hold:");
    expect(h.api.keyboard("sendPhoto")[0]?.map((button) => button.text)).toEqual([
      "Sell 25%",
      "Sell 50%",
      "Sell 100%",
    ]);
    // The recap (message 50) loses its keyboard; the click is answered without a text.
    expect(h.api.of("editMessageReplyMarkup").at(-1)?.payload).toMatchObject({ message_id: 50 });
    expect(h.lastAlert()).not.toHaveProperty("text");
    expect(h.simRunner.isRunning(TEST_USER.id)).toBe(true);
    // The logo of the draft was read once, for the whole run.
    expect(h.images.requested).toEqual(["file-1"]);

    await h.advance(3000);
    expect(h.edits()).toHaveLength(1);
    expect(h.edits()[0]?.payload).toMatchObject({ message_id: FIRST_MESSAGE_ID });
    expect(h.caption(h.edits()[0]!)).toContain("⏱ 0:06 / 3:00");
  });

  it("answers a stale button for an unknown simulation or another user's", async () => {
    const h = harness();
    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));
    h.simulations.rows[0]!.userId = "someone-else";

    await feed(h.bot, callbackUpdate(SIM_CB.go("s1")));
    expect(h.lastAlert()).toMatchObject({ text: en.common.staleButton });
    await feed(h.bot, callbackUpdate(SIM_CB.go("nope")));
    expect(h.lastAlert()).toMatchObject({ text: en.common.staleButton });
    expect(h.photos()).toHaveLength(0);
  });

  it("refuses a second simulation while one runs, with the flag on the recap", async () => {
    const h = harness();
    await h.start();

    await feed(h.bot, callbackUpdate(SIM_CB.go("s1")));

    expect(h.lastAlert()).toMatchObject({
      text: "A simulation is already running.",
      show_alert: true,
    });
    expect(h.api.screen()).toContain("⚠️ A simulation is already running.");
    expect(h.api.screen()).toContain("<b>📊 SIMULATION · STEP 3/3</b>");
    expect(h.photos()).toHaveLength(1);
  });

  it("refuses when the runner is full, before reading any logo", async () => {
    const h = harness({ maxActive: 0 });
    await h.start();

    expect(h.lastAlert()).toMatchObject({ text: "The simulator is busy. Try again in a minute." });
    expect(h.api.screen()).toContain("⚠️ The simulator is busy.");
    expect(h.photos()).toHaveLength(0);
    expect(h.images.requested).toEqual([]);
  });

  it("uses the badge when the logo cannot be read", async () => {
    const h = harness();
    h.images.requested.length = 0;
    const missing = testDraft({
      id: "d1",
      name: "Moon Otter",
      symbol: "OTTR",
      imageFileId: "nope",
    });
    h.drafts.rows.set("d1", missing);

    await h.start();

    expect(h.images.requested).toEqual(["nope"]);
    expect(h.photos()).toHaveLength(1);
  });
});

describe("the buttons under the picture", () => {
  it("sells at the click, tells what was sold, and refuses a second tap in the same second", async () => {
    const h = harness();
    await h.start();
    await h.advance(3000);

    await feed(h.bot, callbackUpdate("sim:sell:s1:25", { messageId: 100 }));
    expect(h.lastAlert()?.["text"]).toMatch(/^Sold 25%: [\d.]+[KMB]? OTTR for [\d.]+ SOL\.$/);
    await feed(h.bot, callbackUpdate("sim:sell:s1:25", { messageId: 100 }));
    expect(h.lastAlert()).toMatchObject({ text: "One sale at a time." });

    await h.advance(1000);
    expect(h.caption(h.edits().at(-1)!)).toContain("Sold so far:");
  });

  it("closes the position with Sell 100%: the card replaces the picture, then Run again restarts on it", async () => {
    const h = harness();
    await h.start();
    await h.advance(3000);

    await feed(h.bot, callbackUpdate("sim:sell:s1:100", { messageId: 100 }));
    await h.advance(1000);
    // The sale drawn first, on a photo; then the card as an animation, after the hold.
    const sold = h.edits().at(-1)!;
    expect(sold.payload["media"]).toMatchObject({ type: "photo" });
    expect(h.caption(sold)).toContain("Sold so far:");
    await h.advance(SIM_END_HOLD_MS + 1000);

    const card = h.edits().at(-1)!;
    expect(card).not.toBe(sold);
    expect(card.payload["media"]).toMatchObject({ type: "animation" });
    expect(h.caption(card)).toContain("<b>📊 SIMULATION ENDED</b>");
    expect(h.caption(card)).toContain("💰 Profit:");
    expect(h.api.keyboard("editMessageMedia", -1)[0]?.map((button) => button.text)).toEqual([
      "🔁 Run again",
      "🏠 Menu",
    ]);
    expect(h.simRunner.isRunning(TEST_USER.id)).toBe(false);

    await feed(h.bot, callbackUpdate("sim:sell:s1:25", { messageId: 100 }));
    expect(h.lastAlert()).toMatchObject({ text: en.sim.live.over, show_alert: true });

    // Menu under the card: a picture has no text to edit, the home is a new message.
    await feed(h.bot, callbackUpdate(NAV_HOME, { messageId: 100, photo: true }));
    expect(h.api.of("editMessageText").some((call) => call.payload["message_id"] === 100)).toBe(
      false,
    );
    expect(h.api.text("sendMessage", -1)).toContain("LAUNCH BOT");

    await feed(h.bot, callbackUpdate("sim:again:s1", { messageId: 100 }));
    expect(h.simulations.rows).toHaveLength(2);
    const [first, second] = h.simulations.rows;
    expect(second).toMatchObject({
      userId: first!.userId,
      tokenDraftId: "d1",
      devBuySol: "1",
      bundleSol: "5",
    });
    expect(second!.seed).not.toBe(first!.seed);
    expect(simConfigSchema.parse(second!.params)).toEqual({
      ...simConfigSchema.parse(first!.params),
      seed: second!.seed,
    });
    const restarted = h.edits().at(-1)!;
    expect(restarted.payload).toMatchObject({ message_id: 100 });
    expect(h.caption(restarted)).toContain("⏱ 0:00 / 3:00");
    expect(h.photos()).toHaveLength(1);
    expect(h.simRunner.isRunning(TEST_USER.id)).toBe(true);
  });

  it("pauses, resumes and changes the speed", async () => {
    const h = harness();
    await h.start();

    await feed(h.bot, callbackUpdate("sim:pause:s1", { messageId: 100 }));
    await h.advance(1000);
    expect(h.caption(h.edits().at(-1)!)).toContain("⏸ Paused");
    await h.advance(6000);
    expect(h.caption(h.edits().at(-1)!)).toContain("⏱ 0:00 / 3:00");

    await feed(h.bot, callbackUpdate("sim:speed:s1:5", { messageId: 100 }));
    await feed(h.bot, callbackUpdate("sim:resume:s1", { messageId: 100 }));
    await h.advance(1000);
    expect(h.caption(h.edits().at(-1)!)).toContain("Speed x5");
    await h.advance(3000);
    expect(h.caption(h.edits().at(-1)!)).toContain("⏱ 0:15 / 3:00");

    await feed(h.bot, callbackUpdate("sim:speed:s1:7", { messageId: 100 }));
    expect(h.lastAlert()).toMatchObject({ text: en.common.staleButton });
    await feed(h.bot, callbackUpdate("sim:pause:s9", { messageId: 100 }));
    expect(h.lastAlert()).toMatchObject({ text: en.sim.live.over });
  });

  it("Run again respects the limit of creations", async () => {
    const h = harness();
    await h.start();
    await feed(h.bot, callbackUpdate("sim:sell:s1:100", { messageId: 100 }));
    await h.advance(SIM_END_HOLD_MS + 2000);
    for (let i = 0; i < RATE_LIMITS.simulation.limit; i += 1) {
      consumeRateLimit(Number(TEST_USER.telegramId), "simulation");
    }

    await feed(h.bot, callbackUpdate("sim:again:s1", { messageId: 100 }));

    expect(h.lastAlert()).toMatchObject({ text: en.sim.rateLimited.alert, show_alert: true });
    expect(h.simulations.rows).toHaveLength(1);
  });
});
