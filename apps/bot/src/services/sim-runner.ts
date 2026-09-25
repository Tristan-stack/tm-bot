import {
  SECOND_MS,
  SIM_DEFAULT_SPEED,
  SIM_END_HOLD_MS,
  SIM_FRAME_MS,
  SIM_MAX_ACTIVE,
  SIM_MIN_EDIT_GAP_MS,
  SIM_PAUSE_TIMEOUT_MS,
} from "@launchbot/shared";
import type { SimSpeed, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import {
  createCandleAggregator,
  createSimulation,
  curveProgress,
  marketCapSol,
} from "@launchbot/sim-engine";
import type {
  CandleAggregator,
  EndReason,
  SimConfig,
  SimulationRun,
  TradeEvent,
} from "@launchbot/sim-engine";
import {
  buildPnlCardModel,
  buildPositionView,
  renderChartPng,
  renderLogo,
  renderPnlCardVideo,
} from "@launchbot/sim-render";
import type { ChartFrame, Logo, LogoImage, PnlCardModel, SimToken } from "@launchbot/sim-render";
import type { InlineKeyboardMarkup } from "grammy/types";
import {
  buildEndedCaption,
  buildEndedKeyboard,
  buildLiveCaption,
  buildLiveKeyboard,
} from "../features/simulation/caption.js";
import type { LiveView } from "../features/simulation/caption.js";
import type { SellPct } from "../features/simulation/screens.js";

const log = createLogger("bot:sim-runner");

export type SimMessage = { chatId: number; messageId: number };
/** `gone`: the message no longer exists, or cannot be edited. */
export type EditOutcome = "edited" | "gone";

/** The two calls the runner makes to Telegram, behind an interface so the tests fake them. */
export type SimTelegram = {
  sendPhoto(
    chatId: number,
    png: Uint8Array,
    caption: string,
    keyboard: InlineKeyboardMarkup,
  ): Promise<number>;
  editPhoto(
    target: SimMessage,
    png: Uint8Array,
    caption: string,
    keyboard: InlineKeyboardMarkup,
  ): Promise<EditOutcome>;
  /** The card (§6.3): the same message becomes an animation, an MP4 without sound. */
  editAnimation(
    target: SimMessage,
    mp4: Uint8Array,
    caption: string,
    keyboard: InlineKeyboardMarkup,
  ): Promise<EditOutcome>;
};

export type SimRender = {
  chart(frame: ChartFrame): Promise<Uint8Array>;
  /** The animation of the card, as MP4. */
  card(card: PnlCardModel, logo: Logo | null): Promise<Uint8Array>;
  /** Once per run: the logo shrunk to what a frame embeds. */
  logo(image: LogoImage): Promise<Logo>;
};

/** Real time and timers, injectable: the tests drive a virtual clock. */
export type Scheduler = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
};

export type SimRunnerDeps = {
  ui: Ui;
  telegram: SimTelegram;
  render?: SimRender;
  scheduler?: Scheduler;
  maxActive?: number;
};

export type StartInput = {
  simId: string;
  userId: string;
  chatId: number;
  config: SimConfig;
  token: SimToken;
  /** Read once the run is reserved, after the click is answered; null gives the badge. */
  logo: () => Promise<LogoImage | null>;
  /** Run again (§6.3): the picture replaces this message instead of a new one. */
  messageId?: number;
};
/** `ok` is decided at once, so a second click is refused before any upload; `ready` is the first picture. */
export type StartResult =
  { kind: "ok"; ready: Promise<void> } | { kind: "already_running" } | { kind: "full" };
/** A button names its simulation; the runner refuses a user who is not its owner. */
export type Owner = { simId: string; userId: string };
export type SellResult =
  | { kind: "ok"; event: TradeEvent; ticker: string }
  | { kind: "unknown" }
  | { kind: "busy" }
  | { kind: "empty" };
export type ControlResult = "ok" | "unknown";

export type SimRunner = {
  start(input: StartInput): StartResult;
  sell(owner: Owner, pct: SellPct): SellResult;
  pause(owner: Owner): ControlResult;
  resume(owner: Owner): ControlResult;
  setSpeed(owner: Owner, speed: SimSpeed): ControlResult;
  /** Cancels every timer; the messages stay as they are (§6.1). */
  stop(): void;
  // For the tests.
  isRunning(userId: string): boolean;
  activeCount(): number;
  /** Every edit and card in flight. */
  idle(): Promise<void>;
};

type Entry = {
  simId: string;
  userId: string;
  chatId: number;
  messageId: number;
  config: SimConfig;
  token: SimToken;
  logo: Logo | null;
  run: SimulationRun;
  aggregator: CandleAggregator;
  /** Simulated time in integer milliseconds: the same seed gives the same run whatever the cadence. */
  simMs: number;
  speed: SimSpeed;
  paused: boolean;
  lastTickAt: number;
  lastEditAt: number;
  lastSellAt: number;
  frameTimer: unknown;
  pauseTimer: unknown;
  editQueued: boolean;
  /** Every write to the message, in order: the first picture, the edits, the card. */
  chain: Promise<void>;
};

const defaultRender: SimRender = {
  chart: renderChartPng,
  card: renderPnlCardVideo,
  logo: renderLogo,
};
const defaultScheduler: Scheduler = {
  now: Date.now,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

/**
 * The simulations running in the chat (§6.4): one run per active message, in memory,
 * advanced by a timer every `SIM_FRAME_MS`, drawn by sim-render and edited into the message.
 * Every write to a message goes through a per-entry chain, so a tick, a sale and the card
 * never overlap, and two edits stay at least `SIM_MIN_EDIT_GAP_MS` apart. Nothing survives
 * a restart.
 */
export function createSimRunner(deps: SimRunnerDeps): SimRunner {
  const { ui, telegram, render = defaultRender, scheduler = defaultScheduler } = deps;
  const maxActive = deps.maxActive ?? SIM_MAX_ACTIVE;
  const entries = new Map<string, Entry>();

  /** An entry is alive while it is the one registered under its id: `dispose` ends it. */
  const alive = (entry: Entry): boolean => entries.get(entry.simId) === entry;
  const isRunning = (userId: string): boolean =>
    [...entries.values()].some((entry) => entry.userId === userId);
  const target = (entry: Entry): SimMessage => ({
    chatId: entry.chatId,
    messageId: entry.messageId,
  });
  const nowSec = (entry: Entry): number => entry.simMs / SECOND_MS;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => scheduler.setTimeout(resolve, ms));

  /** The trades into the candles; a frame without a trade still opens the flat candles. */
  const ingest = (entry: Entry, events: readonly TradeEvent[]): void => {
    entry.aggregator.push(events, nowSec(entry));
  };

  const frameOf = (entry: Entry): ChartFrame => ({
    token: entry.token,
    clock: { nowSec: nowSec(entry), durationSec: entry.config.durationSec },
    candles: entry.aggregator.candles(),
    config: entry.config,
    logo: entry.logo,
  });

  const liveView = (entry: Entry): LiveView => {
    const state = entry.run.state();
    const totals = { volumeSol: 0, buys: 0, sells: 0 };
    for (const candle of entry.aggregator.candles()) {
      totals.volumeSol += candle.volumeSol;
      totals.buys += candle.buys;
      totals.sells += candle.sells;
    }
    return {
      token: entry.token,
      clock: { nowSec: nowSec(entry), durationSec: entry.config.durationSec },
      speed: entry.speed,
      paused: entry.paused,
      solUsdPrice: entry.config.solUsdPrice,
      stats: {
        marketCapSol: marketCapSol(state, entry.config.curve),
        progress: curveProgress(state, entry.config.curve),
        ...totals,
      },
      position: buildPositionView(entry.run.position(), entry.config, entry.token.ticker),
    };
  };

  const livePicture = async (entry: Entry) => ({
    png: await render.chart(frameOf(entry)),
    caption: buildLiveCaption(ui, liveView(entry)),
    keyboard: buildLiveKeyboard(entry.simId, { speed: entry.speed, paused: entry.paused }),
  });

  /** Removes the entry and its timers: no further step, edit or card. */
  const dispose = (entry: Entry): void => {
    scheduler.clearTimeout(entry.frameTimer);
    scheduler.clearTimeout(entry.pauseTimer);
    if (alive(entry)) entries.delete(entry.simId);
  };

  const enqueue = (entry: Entry, task: () => Promise<void>): void => {
    entry.chain = entry.chain.then(task).catch((error: unknown) => {
      // The reason and the id only: the caption carries the name of the token.
      log.error({ err: error, simId: entry.simId }, "Simulation message failed");
      dispose(entry);
    });
  };

  /** The picture of the state of the moment, never closer than the gap to the last edit. */
  const editLive = async (entry: Entry): Promise<EditOutcome> => {
    const wait = entry.lastEditAt + SIM_MIN_EDIT_GAP_MS - scheduler.now();
    if (wait > 0) await sleep(wait);
    const { png, caption, keyboard } = await livePicture(entry);
    const outcome = await telegram.editPhoto(target(entry), png, caption, keyboard);
    entry.lastEditAt = scheduler.now();
    return outcome;
  };

  /** One edit, coalesced: a request while one is queued is served by it. */
  const requestEdit = (entry: Entry): void => {
    if (entry.editQueued || !alive(entry)) return;
    entry.editQueued = true;
    enqueue(entry, async () => {
      entry.editQueued = false;
      if (!alive(entry)) return;
      if ((await editLive(entry)) === "gone") dispose(entry);
    });
  };

  /**
   * The end (§6.3): the last picture (the closing sale drawn, when there is one) stays
   * `SIM_END_HOLD_MS`, then the card replaces it, after whatever edit is in flight.
   */
  const end = (entry: Entry, reason: EndReason): void => {
    if (!alive(entry)) return;
    log.debug({ simId: entry.simId, reason }, "Simulation ended");
    dispose(entry);
    enqueue(entry, async () => {
      if ((await editLive(entry)) === "gone") return;
      await sleep(SIM_END_HOLD_MS);
      const card = buildPnlCardModel({
        position: entry.run.position(),
        config: entry.config,
        token: entry.token,
      });
      const mp4 = await render.card(card, entry.logo);
      await telegram.editAnimation(
        target(entry),
        mp4,
        buildEndedCaption(ui, card),
        buildEndedKeyboard(entry.simId),
      );
    });
  };

  const scheduleFrame = (entry: Entry): void => {
    entry.frameTimer = scheduler.setTimeout(() => tick(entry), SIM_FRAME_MS);
  };

  /** The real time since the last tick, at the current speed, into the run; then a picture. */
  const tick = (entry: Entry): void => {
    if (!alive(entry) || entry.paused) return;
    const now = scheduler.now();
    const durationMs = Math.round(entry.config.durationSec * SECOND_MS);
    entry.simMs = Math.min(
      durationMs,
      entry.simMs + Math.round(now - entry.lastTickAt) * entry.speed,
    );
    entry.lastTickAt = now;
    ingest(entry, entry.run.advanceTo(nowSec(entry)));
    const reason = entry.run.endReason();
    if (reason !== null) return end(entry, reason);
    requestEdit(entry);
    scheduleFrame(entry);
  };

  const owned = (owner: Owner): Entry | undefined => {
    const entry = entries.get(owner.simId);
    return entry !== undefined && entry.userId === owner.userId ? entry : undefined;
  };

  /** A control of the owner: `apply` changes the entry and says whether a picture is due. */
  const control = (owner: Owner, apply: (entry: Entry) => boolean): ControlResult => {
    const entry = owned(owner);
    if (entry === undefined) return "unknown";
    if (apply(entry)) requestEdit(entry);
    return "ok";
  };

  return {
    start(input) {
      if (isRunning(input.userId)) return { kind: "already_running" };
      if (entries.size >= maxActive) return { kind: "full" };
      const run = createSimulation(input.config);
      const entry: Entry = {
        simId: input.simId,
        userId: input.userId,
        chatId: input.chatId,
        messageId: input.messageId ?? 0,
        config: input.config,
        token: input.token,
        logo: null,
        run,
        aggregator: createCandleAggregator({
          initialPrice: input.config.curve.virtualSol / input.config.curve.virtualTokens,
          durationSec: input.config.durationSec,
        }),
        simMs: 0,
        speed: SIM_DEFAULT_SPEED,
        paused: false,
        lastTickAt: scheduler.now(),
        lastEditAt: 0,
        lastSellAt: 0,
        frameTimer: undefined,
        pauseTimer: undefined,
        editQueued: false,
        chain: Promise.resolve(),
      };
      ingest(entry, run.openingBuys());
      // Reserved before the first upload: a second click during it is refused.
      entries.set(entry.simId, entry);

      const ready = (async () => {
        try {
          const image = await input.logo();
          entry.logo = image === null ? null : await render.logo(image);
          const { png, caption, keyboard } = await livePicture(entry);
          if (
            input.messageId === undefined ||
            // Run again on a message the user deleted: a new one, rather than nothing.
            (await telegram.editPhoto(target(entry), png, caption, keyboard)) === "gone"
          ) {
            entry.messageId = await telegram.sendPhoto(entry.chatId, png, caption, keyboard);
          }
        } catch (error) {
          dispose(entry);
          throw error;
        }
        if (!alive(entry)) return;
        entry.lastEditAt = scheduler.now();
        entry.lastTickAt = scheduler.now();
        scheduleFrame(entry);
      })();
      // Every later write waits for the first picture; its failure is the caller's to report.
      entry.chain = ready.catch(() => undefined);
      return { kind: "ok", ready };
    },

    sell(owner, pct) {
      const entry = owned(owner);
      if (entry === undefined) return { kind: "unknown" };
      const now = scheduler.now();
      if (now - entry.lastSellAt < SIM_MIN_EDIT_GAP_MS) return { kind: "busy" };
      if (entry.run.position().tokens <= 0) return { kind: "empty" };
      // Sold at the simulated instant of the click, in a run as in a pause (§6.2).
      const sale = entry.run.sellDev(pct / 100);
      entry.lastSellAt = now;
      // A Sell 100% brings the panic of the holders with it: the last candle shows the fall.
      ingest(entry, [sale.event, ...sale.panic]);
      const reason = entry.run.endReason();
      if (reason !== null) end(entry, reason);
      else requestEdit(entry);
      return { kind: "ok", event: sale.event, ticker: entry.token.ticker };
    },

    pause: (owner) =>
      control(owner, (entry) => {
        if (entry.paused) return false;
        entry.paused = true;
        scheduler.clearTimeout(entry.frameTimer);
        entry.pauseTimer = scheduler.setTimeout(() => end(entry, "timeout"), SIM_PAUSE_TIMEOUT_MS);
        return true;
      }),

    resume: (owner) =>
      control(owner, (entry) => {
        if (!entry.paused) return false;
        entry.paused = false;
        scheduler.clearTimeout(entry.pauseTimer);
        entry.lastTickAt = scheduler.now();
        scheduleFrame(entry);
        return true;
      }),

    // The real time since the last tick runs at the new speed on the next one.
    setSpeed: (owner, speed) =>
      control(owner, (entry) => {
        if (entry.speed === speed) return false;
        entry.speed = speed;
        return true;
      }),

    stop() {
      for (const entry of [...entries.values()]) dispose(entry);
    },

    isRunning,
    activeCount: () => entries.size,
    idle: async () => {
      await Promise.all([...entries.values()].map((entry) => entry.chain));
    },
  };
}
