import { createUi, SIM_END_HOLD_MS } from "@launchbot/shared";
import { createSimulation } from "@launchbot/sim-engine";
import { buildPnlCardModel } from "@launchbot/sim-render";
import { simConfig } from "@launchbot/sim-engine/test-helpers";
import type { InlineKeyboardMarkup } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { buttonTexts, fakeRender, fakeScheduler } from "../test-harness.js";
import { createSimRunner } from "./sim-runner.js";
import type { EditOutcome, SimTelegram } from "./sim-runner.js";

const ui = createUi("devnet");
const config = simConfig();
const CHAT = 777;
const TOKEN = { name: "Moon Otter", ticker: "OTTR" };

type Edit = {
  messageId: number;
  caption: string;
  keyboard: InlineKeyboardMarkup;
  /** The decoded bytes of the fake renderer: `chart@<sec>`, or `card:<pnl>` for the animation. */
  png: string;
};

function fakeTelegram(options: { editOutcome?: () => EditOutcome } = {}) {
  const sent: Edit[] = [];
  const edits: Edit[] = [];
  const decode = (png: Uint8Array) => new TextDecoder().decode(png);
  const telegram: SimTelegram = {
    sendPhoto: vi.fn<SimTelegram["sendPhoto"]>((_chatId, png, caption, keyboard) => {
      sent.push({ messageId: 100 + sent.length, caption, keyboard, png: decode(png) });
      return Promise.resolve(100 + sent.length - 1);
    }),
    editPhoto: vi.fn<SimTelegram["editPhoto"]>(({ messageId }, png, caption, keyboard) => {
      edits.push({ messageId, caption, keyboard, png: decode(png) });
      return Promise.resolve(options.editOutcome?.() ?? "edited");
    }),
    editAnimation: vi.fn<SimTelegram["editAnimation"]>(({ messageId }, mp4, caption, keyboard) => {
      edits.push({ messageId, caption, keyboard, png: decode(mp4) });
      return Promise.resolve("edited");
    }),
  };
  return { telegram, sent, edits };
}

function harness(options: Parameters<typeof fakeTelegram>[0] & { maxActive?: number } = {}) {
  const clock = fakeScheduler();
  const tg = fakeTelegram(options);
  const runner = createSimRunner({
    ui,
    telegram: tg.telegram,
    render: fakeRender,
    scheduler: clock.scheduler,
    maxActive: options.maxActive ?? 20,
  });
  /** Starts and waits for the first picture: the kind of the reservation. */
  const start = async (simId = "s1", userId = "u1", messageId?: number, onEnd?: () => void) => {
    const result = runner.start({
      simId,
      userId,
      chatId: CHAT,
      config,
      token: TOKEN,
      logo: () => Promise.resolve(null),
      messageId,
      onEnd,
    });
    if (result.kind === "ok") await result.ready;
    return result.kind;
  };
  return { ...clock, ...tg, runner, start };
}

describe("createSimRunner", () => {
  it("sends the first picture at 0:00 with the buttons, then edits one picture per frame", async () => {
    const h = harness();

    expect(await h.start()).toBe("ok");

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.caption).toContain("⏱ 0:00 / 3:00 · Speed x2");
    expect(h.sent[0]?.caption).toContain(
      "⚠️ DEMO — Bullish scenario. Not a prediction or a real result.",
    );
    expect(h.sent[0]?.png).toBe("chart@0");
    expect(buttonTexts(h.sent[0]!.keyboard)).toEqual([
      ["Sell 25%", "Sell 50%", "Sell 100%"],
      ["⏸ Pause", "x1", "✅ x2", "x5"],
    ]);
    expect(h.runner.isRunning("u1")).toBe(true);

    await h.advance(3000);
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]).toMatchObject({ messageId: 100, png: "chart@6" });
    expect(h.edits[0]?.caption).toContain("⏱ 0:06 / 3:00 · Speed x2");
    await h.advance(3000);
    expect(h.edits[1]?.png).toBe("chart@12");
  });

  it("plays the same trades as the engine in one go, at x1 and at x5", async () => {
    const reference = createSimulation(config);
    const expected = reference.step(180);
    const card = buildPnlCardModel({ position: reference.position(), config, token: TOKEN });

    for (const speed of [1, 5] as const) {
      const h = harness();
      await h.start();
      h.runner.setSpeed({ simId: "s1", userId: "u1" }, speed);
      const seconds = 180 / speed;
      // Frames of 3 s, a last one to be sure the end is reached, then the hold before the card.
      await h.advance(seconds * 1000 + 3000 + SIM_END_HOLD_MS + 1000);
      await h.runner.idle();

      const last = h.edits.at(-1);
      expect(last?.png.startsWith("card:")).toBe(true);
      expect(last?.caption).toContain("📊 SIMULATION ENDED");
      expect(last?.caption).toContain(`<b>$OTTR</b> | ${card.pnlPctText}`);
      expect(h.runner.isRunning("u1")).toBe(false);
      // The final position depends on every trade of the run: the same card means the same trades.
      expect(last?.caption).toContain(`Sell: ${card.positionSolText} SOL`);
      expect(last?.caption).toContain(`Profit: ${card.pnlSolBig} SOL`);
      expect(expected.length).toBeGreaterThan(50);
    }
  });

  it("a sale is drawn within the second, and a second tap in that second is refused", async () => {
    const h = harness();
    await h.start();
    await h.advance(3000);

    const first = h.runner.sell({ simId: "s1", userId: "u1" }, 25);
    expect(first).toMatchObject({ kind: "ok", ticker: "OTTR" });
    expect(h.runner.sell({ simId: "s1", userId: "u1" }, 25).kind).toBe("busy");
    expect(h.runner.sell({ simId: "s1", userId: "other" }, 25).kind).toBe("unknown");

    await h.advance(1000);
    expect(h.edits).toHaveLength(2);
    expect(h.edits[1]?.caption).toContain("Sold so far:");
    expect(h.edits[1]?.caption).toMatch(/Buys \/ Sells: \d+ \/ [1-9]\d*/);

    await h.advance(1000);
    const closing = h.runner.sell({ simId: "s1", userId: "u1" }, 100);
    expect(closing.kind).toBe("ok");
    expect(h.runner.isRunning("u1")).toBe(false);
    // The closing sale is drawn at once and stays SIM_END_HOLD_MS, then the animation of the card.
    await h.advance(0);
    const last = h.edits.at(-1);
    expect(last?.png).toBe("chart@6");
    expect(last?.caption).toContain("Sold so far:");
    expect(last?.caption).toContain("PnL:");
    await h.advance(SIM_END_HOLD_MS - 500);
    expect(h.edits.at(-1)).toBe(last);
    await h.advance(1000);
    await h.runner.idle();
    const card = h.edits.at(-1);
    expect(card?.png.startsWith("card:")).toBe(true);
    expect(card?.caption).toContain("💰 Profit:");
    expect(buttonTexts(card!.keyboard)).toEqual([["🔁 Run again", "🏠 Menu"]]);
    expect(h.runner.sell({ simId: "s1", userId: "u1" }, 25).kind).toBe("unknown");
    expect(h.pending()).toBe(0);
  });

  it("pauses without a step nor a frame, resumes where it was, and ends a forgotten pause", async () => {
    const h = harness();
    await h.start();
    await h.advance(3000);
    expect(h.edits[0]?.caption).toContain("0:06 / 3:00");

    expect(h.runner.pause({ simId: "s1", userId: "u1" })).toBe("ok");
    await h.advance(1000);
    expect(h.edits[1]?.caption).toContain("⏱ 0:06 / 3:00 · ⏸ Paused");
    expect(buttonTexts(h.edits[1]!.keyboard)[1]?.[0]).toBe("▶️ Resume");
    await h.advance(9000);
    expect(h.edits).toHaveLength(2);

    expect(h.runner.resume({ simId: "s1", userId: "u1" })).toBe("ok");
    await h.advance(1000);
    expect(h.edits[2]?.caption).toContain("0:06 / 3:00 · Speed x2");
    await h.advance(3000);
    expect(h.edits[3]?.caption).toContain("0:12 / 3:00");

    h.runner.pause({ simId: "s1", userId: "u1" });
    await h.advance(10 * 60 * 1000 + 1000 + SIM_END_HOLD_MS + 1000);
    await h.runner.idle();
    expect(h.edits.at(-1)?.caption).toContain("SIMULATION ENDED");
  });

  it("changes the speed for the next frame and checks the button", async () => {
    const h = harness();
    await h.start();

    expect(h.runner.setSpeed({ simId: "s1", userId: "u1" }, 5)).toBe("ok");
    await h.advance(1000);
    expect(buttonTexts(h.edits[0]!.keyboard)[1]).toEqual(["⏸ Pause", "x1", "x2", "✅ x5"]);
    expect(h.edits[0]?.caption).toContain("Speed x5");
    await h.advance(2000);
    expect(h.edits[1]?.caption).toContain("⏱ 0:15 / 3:00");
    expect(h.runner.setSpeed({ simId: "nope", userId: "u1" }, 1)).toBe("unknown");
  });

  it("refuses a second simulation of the same user at once, and any beyond the cap", async () => {
    const h = harness({ maxActive: 2 });
    // Reserved before the first upload: the same user is refused while it is in flight.
    const first = h.runner.start({
      simId: "s1",
      userId: "u1",
      chatId: CHAT,
      config,
      token: TOKEN,
      logo: () => Promise.resolve(null),
    });
    expect(first.kind).toBe("ok");
    expect(await h.start("s2", "u1")).toBe("already_running");
    expect(await h.start("s3", "u2")).toBe("ok");
    expect(await h.start("s4", "u3")).toBe("full");
    expect(h.runner.activeCount()).toBe(2);
    await h.runner.idle();
    expect(h.sent).toHaveLength(2);
  });

  it("stops quietly when the message is gone, and edits the given message on Run again", async () => {
    let outcome: EditOutcome = "edited";
    const h = harness({ editOutcome: () => outcome });
    await h.start();
    outcome = "gone";
    await h.advance(3000);
    expect(h.runner.isRunning("u1")).toBe(false);
    expect(h.edits).toHaveLength(1);
    await h.advance(6000);
    expect(h.edits).toHaveLength(1);
    expect(h.pending()).toBe(0);

    outcome = "edited";
    expect(await h.start("s2", "u1", 100)).toBe("ok");
    expect(h.sent).toHaveLength(1);
    expect(h.edits[1]).toMatchObject({ messageId: 100, png: "chart@0" });
  });

  it("stop() cancels every timer and edits nothing more", async () => {
    const h = harness();
    await h.start("s1", "u1");
    await h.start("s2", "u2");
    await h.advance(3000);
    expect(h.edits).toHaveLength(2);

    h.runner.stop();
    await h.advance(10_000);

    expect(h.edits).toHaveLength(2);
    expect(h.pending()).toBe(0);
    expect(h.runner.activeCount()).toBe(0);
  });

  it("drops a simulation whose edit fails for another reason, without throwing", async () => {
    const h = harness();
    await h.start();
    (h.telegram.editPhoto as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));

    await h.advance(3000);
    await h.runner.idle();

    expect(h.runner.isRunning("u1")).toBe(false);
    expect(h.pending()).toBe(0);
  });

  it("calls onEnd once when a run ends, never for a message gone or a stop", async () => {
    const ended = harness();
    const onEnd = vi.fn();
    await ended.start("s1", "u1", undefined, onEnd);
    ended.runner.setSpeed({ simId: "s1", userId: "u1" }, 5);
    await ended.advance(180_000 / 5 + 3000);
    expect(onEnd).toHaveBeenCalledOnce();
    await ended.advance(SIM_END_HOLD_MS + 1000);
    await ended.runner.idle();
    expect(onEnd).toHaveBeenCalledOnce();

    const sold = harness();
    const onSold = vi.fn();
    await sold.start("s1", "u1", undefined, onSold);
    await sold.advance(3000);
    sold.runner.sell({ simId: "s1", userId: "u1" }, 100);
    expect(onSold).toHaveBeenCalledOnce();

    // A deleted message, then a stopped bot: neither is an end.
    const gone = harness({ editOutcome: () => "gone" });
    const stopped = harness();
    const never = vi.fn();
    await gone.start("s1", "u1", undefined, never);
    await stopped.start("s1", "u1", undefined, never);
    stopped.runner.stop();
    await gone.advance(200_000);
    await stopped.advance(200_000);
    expect(gone.runner.activeCount() + stopped.runner.activeCount()).toBe(0);
    expect(never).not.toHaveBeenCalled();
  });

  it("reports a failed first upload to the caller and frees the user", async () => {
    const h = harness();
    (h.telegram.sendPhoto as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));

    await expect(h.start()).rejects.toThrow("network");

    expect(h.runner.isRunning("u1")).toBe(false);
    expect(h.pending()).toBe(0);
  });
});
