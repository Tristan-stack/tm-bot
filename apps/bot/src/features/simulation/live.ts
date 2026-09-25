import type { SimulationStore, SimulationWithDraft } from "@launchbot/db";
import {
  en,
  formatSol,
  formatTokenAmount,
  hasNameAndTicker,
  SIM_SPEEDS,
  simConfigSchema,
  solToLamports,
} from "@launchbot/shared";
import type { SimSpeed, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { TokenImageService } from "@launchbot/shared/server";
import type { SimConfig } from "@launchbot/sim-engine";
import type { LogoImage } from "@launchbot/sim-render";
import type { BotContext } from "../../context.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { blockWithFlag, dropKeyboard } from "../../navigation/show-screen.js";
import type { Block } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { Owner, SimRunner } from "../../services/sim-runner.js";
import type { SimulationService } from "../../services/simulation.js";
import { buildRecapScreen, SELL_PCTS } from "./screens.js";
import type { RecapView, SellPct } from "./screens.js";

const log = createLogger("bot:simulation:live");

export type LiveDeps = {
  ui: Ui;
  store: Pick<SimulationStore, "findOwnedWithDraft">;
  simulations: Pick<SimulationService, "restart">;
  runner: SimRunner;
  images: TokenImageService;
};

const isSellPct = (value: number): value is SellPct =>
  (SELL_PCTS as readonly number[]).includes(value);
const isSpeed = (value: number): value is SimSpeed =>
  (SIM_SPEEDS as readonly number[]).includes(value);

/** A draft accepted by Continue has a name and a ticker; a Simulation row was made from one. */
type ReadySim = SimulationWithDraft & { tokenDraft: { name: string; symbol: string } };
const isReady = (row: SimulationWithDraft): row is ReadySim => hasNameAndTicker(row.tokenDraft);

/**
 * The buttons of the simulation in the chat (§6.1 to §6.3): Start from the recap, Sell, Pause,
 * Resume, the speeds and Run again. Thin handlers: the runner owns the run, the store the row.
 */
export function createLiveHandlers(deps: LiveDeps): Record<string, CallbackHandler> {
  const { ui, store, simulations, runner, images } = deps;
  const { live } = en.sim;
  const refusals: Record<"already_running" | "full", Block> = {
    already_running: live.alreadyRunning,
    full: live.busy,
  };

  /** The row of a button, when it is this user's and still readable; null answers "stale". */
  async function ownedSim(ctx: BotContext, simId: string | undefined): Promise<ReadySim | null> {
    if (simId === undefined) return null;
    const row = await store.findOwnedWithDraft(ctx.user.id, simId);
    return row !== null && isReady(row) ? row : null;
  }

  const recapOf = (sim: ReadySim, config: SimConfig): RecapView => ({
    draft: sim.tokenDraft,
    config,
    simId: sim.id,
  });

  async function logoOf(fileId: string | null): Promise<LogoImage | null> {
    if (fileId === null) return null;
    try {
      const { bytes, contentType } = await images.get(fileId);
      // resvg reads PNG and JPEG; a WEBP logo becomes the badge.
      return contentType === "image/webp" ? null : { bytes, type: contentType };
    } catch (error) {
      log.warn({ err: error }, "Token logo unavailable, badge used");
      return null;
    }
  }

  /**
   * Runs a row in this chat: the runner is reserved at once (a refusal is the caller's to
   * show), the click is answered, then the first picture is uploaded.
   */
  async function launch(
    ctx: BotContext,
    sim: ReadySim,
    run: { simId: string; config: SimConfig; messageId?: number },
  ): Promise<Block | null> {
    const started = runner.start({
      simId: run.simId,
      userId: ctx.user.id,
      chatId: ctx.chatId ?? Number(ctx.user.telegramId),
      config: run.config,
      token: { name: sim.tokenDraft.name, ticker: sim.tokenDraft.symbol },
      logo: () => logoOf(sim.tokenDraft.imageFileId),
      messageId: run.messageId,
    });
    if (started.kind !== "ok") return refusals[started.kind];
    // The first picture takes a moment: the spinner stops before the upload.
    await acknowledge(ctx);
    await started.ready;
    return null;
  }

  const owner = (ctx: BotContext, simId: string | undefined): Owner => ({
    simId: simId ?? "",
    userId: ctx.user.id,
  });
  const over = (ctx: BotContext) => notify(ctx, live.over, { alert: true });

  return {
    /** ▶️ Start simulation on the recap (D14: the row exists, the click runs it). */
    async go(ctx, [simId]) {
      const sim = await ownedSim(ctx, simId);
      if (sim === null) return notify(ctx, en.common.staleButton);
      const config = simConfigSchema.parse(sim.params);
      const refused = await launch(ctx, sim, { simId: sim.id, config });
      if (refused !== null) {
        return blockWithFlag(ctx, refused, (flag) =>
          buildRecapScreen(ui, recapOf(sim, config), { flags: [flag] }),
        );
      }
      // The recap loses its buttons once the simulation runs: no second Start on it.
      await dropKeyboard(ctx, ctx.callbackQuery?.message?.message_id);
    },

    sell(ctx, [simId, pctArg]) {
      const pct = Number(pctArg);
      if (!isSellPct(pct)) return notify(ctx, en.common.staleButton);
      const result = runner.sell(owner(ctx, simId), pct);
      switch (result.kind) {
        case "unknown":
          return over(ctx);
        case "busy":
          return notify(ctx, live.oneAtATime);
        case "empty":
          return notify(ctx, live.nothingToSell);
        case "ok":
          return notify(
            ctx,
            live.sold(
              pct,
              formatTokenAmount(result.event.tokens),
              result.ticker,
              formatSol(solToLamports(result.event.sol)),
            ),
          );
      }
    },

    pause: (ctx, [simId]) =>
      runner.pause(owner(ctx, simId)) === "unknown" ? over(ctx) : undefined,

    resume: (ctx, [simId]) =>
      runner.resume(owner(ctx, simId)) === "unknown" ? over(ctx) : undefined,

    speed(ctx, [simId, speedArg]) {
      const speed = Number(speedArg);
      if (!isSpeed(speed)) return notify(ctx, en.common.staleButton);
      if (runner.setSpeed(owner(ctx, simId), speed) === "unknown") return over(ctx);
    },

    /** 🔁 Run again on the card (§6.3): a new row with a new seed, on the same message. */
    async again(ctx, [simId]) {
      const sim = await ownedSim(ctx, simId);
      if (sim === null) return notify(ctx, en.common.staleButton);
      const restarted = await simulations.restart({ sim, telegramId: Number(ctx.user.telegramId) });
      if (restarted.kind === "rate_limited") {
        return notify(ctx, en.sim.rateLimited.alert, { alert: true });
      }
      const refused = await launch(ctx, sim, {
        simId: restarted.simId,
        config: restarted.config,
        messageId: ctx.callbackQuery?.message?.message_id,
      });
      if (refused !== null) return notify(ctx, refused.alert, { alert: true });
    },
  };
}
