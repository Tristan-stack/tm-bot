import { en, RATE_LIMITS } from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionData } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  fakeDrafts,
  feed,
  photoUpdate,
  storedSession,
  testDraft,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { TOKEN_CB } from "../token-step/screens.js";
import { SIM_CB } from "./screens.js";

const CHAT_KEY = "777";
const OTTER = testDraft({
  id: "d1",
  name: "Moon Otter",
  symbol: "OTTR",
  description: "An otter who loves the stars.",
  imageFileId: "file-1",
});

/** The bot with the draft of the mockup already chosen in step 1, as after Generate. */
function harness(
  options: Parameters<typeof botHarness>[0] & { draft?: ReturnType<typeof testDraft> | null } = {},
) {
  const { draft = OTTER, ...rest } = options;
  const h = botHarness({
    drafts: fakeDrafts({ rows: draft === null ? [] : [draft] }),
    ...rest,
  });
  const session: SessionData = { v: 1, tokenStep: { SIMULATION: { draftId: "d1" } } };
  h.prisma.sessions.set(CHAT_KEY, JSON.stringify(session));
  return { ...h, screen: h.api.screen, lastAlert: h.api.lastAlert };
}

beforeEach(resetRateLimits);

describe("Simulate a Launch (V1-22)", () => {
  it("Continue leads to the Dev buy, Back from it to the Token screen", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(TOKEN_CB.next("SIMULATION")));
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 2/3</b>");
    expect(h.screen()).toContain("💰 Dev buy: not selected yet");

    await feed(h.bot, callbackUpdate(SIM_CB.backToToken));
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 1/3</b>");
    expect(h.screen()).toContain("┌ Name: Moon Otter");
  });

  it("a preset creates the Simulation and shows the recap with its web_app button", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));

    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 3/3</b>");
    expect(h.screen()).toContain("💰 Dev buy: 5 SOL (≈ 15.2% of supply)");
    expect(h.screen()).toContain(en.sim.demoBanner);
    expect(h.api.keyboard("editMessageText", -1)[0]).toEqual([
      { text: "▶️ Start simulation", web_app: { url: "https://launchbot.example.com/sim/s1" } },
    ]);
    expect(h.simulations.rows).toHaveLength(1);
    expect(h.simulations.rows[0]).toMatchObject({ tokenDraftId: "d1", devBuySol: "5" });
    expect(storedSession(h.prisma)?.sim).toEqual({ devBuySol: 5 });
  });

  it("Back from the recap shows the Dev buy with the amount; the same choice reuses the row", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));
    await feed(h.bot, callbackUpdate(SIM_CB.backToDevBuy));
    expect(h.screen()).toContain("💰 Dev buy: 5 SOL");

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));
    expect(h.api.keyboard("editMessageText", -1)[0]?.[0]).toMatchObject({
      web_app: { url: "https://launchbot.example.com/sim/s1" },
    });
    expect(h.simulations.rows).toHaveLength(1);

    await feed(h.bot, callbackUpdate(SIM_CB.preset(3)));
    expect(h.simulations.rows).toHaveLength(2);
    expect(h.screen()).toContain("💰 Dev buy: 3 SOL (≈ 9.7% of supply)");
  });

  it("Custom takes a typed amount, refuses one out of bounds with a flag, and cancels", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(SIM_CB.custom));
    expect(h.screen()).toContain("Send the dev buy amount in SOL.");
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "sim_amount" });

    await feed(h.bot, textUpdate("25"));
    expect(h.screen()).toContain("Allowed: 1 to 20 SOL, up to 3 decimals.");
    expect(h.screen().endsWith(en.sim.custom.invalid)).toBe(true);
    expect(h.api.of("deleteMessage")).toHaveLength(1);
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "sim_amount" });

    await feed(h.bot, photoUpdate());
    expect(h.screen().endsWith(en.sim.custom.invalid)).toBe(true);

    await feed(h.bot, textUpdate("2,5 sol"));
    expect(h.screen()).toContain("💰 Dev buy: 2.5 SOL (≈ ");
    expect(h.simulations.rows[0]).toMatchObject({ devBuySol: "2.5" });
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();

    await feed(h.bot, callbackUpdate(SIM_CB.custom));
    await feed(h.bot, callbackUpdate(SIM_CB.cancelCustom));
    expect(h.screen()).toContain("How much SOL should the dev buy at launch?");
    expect(h.screen()).toContain("💰 Dev buy: 2.5 SOL");
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();
  });

  it("over the limit of creations: the alert, the flag on the Dev buy, and no row", async () => {
    const h = harness();
    for (let i = 0; i < RATE_LIMITS.simulation.limit; i += 1) {
      consumeRateLimit(Number(TEST_USER.telegramId), "simulation");
    }

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));

    expect(h.lastAlert()).toMatchObject({ text: en.sim.rateLimited.alert, show_alert: true });
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 2/3</b>");
    expect(h.screen().endsWith(en.sim.rateLimited.flag)).toBe(true);
    expect(h.simulations.rows).toHaveLength(0);
  });

  it("sends back to the Token screen with the Missing flag when the draft lacks a ticker", async () => {
    const h = harness({ draft: testDraft({ id: "d1", name: "Moon Otter" }) });

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));

    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 1/3</b>");
    expect(h.screen()).toContain("⚠️ Missing: ticker");
    expect(h.simulations.rows).toHaveLength(0);
  });

  it("sends back to the Token screen when the draft is gone (a stale button)", async () => {
    const h = harness({ draft: null });

    await feed(h.bot, callbackUpdate(SIM_CB.backToDevBuy));

    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 1/3</b>");
    expect(h.screen()).toContain("⚠️ Missing: name, ticker");
  });

  it("writes the generic error on the Dev buy when the store fails", async () => {
    const h = harness({
      simulations: {
        rows: [],
        findLatest: () => Promise.reject(new Error("db down")),
        create: () => Promise.reject(new Error("db down")),
      },
    });

    await feed(h.bot, callbackUpdate(SIM_CB.preset(5)));

    expect(h.lastAlert()).toMatchObject({ text: en.common.genericError, show_alert: true });
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 2/3</b>");
    expect(h.screen().endsWith(en.common.genericError)).toBe(true);
  });

  it("answers a stale dev buy button, and the menu still opens the Token step", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate("sim:dev:99"));
    expect(h.lastAlert()).toMatchObject({ text: en.common.staleButton });

    await feed(h.bot, callbackUpdate(MENU.simulate));
    expect(h.screen()).toContain("<b>📊 SIMULATION · STEP 1/3</b>");
  });
});
