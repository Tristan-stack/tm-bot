import { createLogger } from "@launchbot/shared/server";

const log = createLogger("worker:loop");

export type Loop = {
  /** No tick starts after it; resolves once the tick in progress is over. */
  stop: () => Promise<void>;
};

/**
 * A task every `intervalMs`, never two at once (V1-32): the next tick is planned at the end of
 * the current one, from its start, so a slow tick is followed at once, with a warning. The
 * pg-boss cron runs every minute at best, too slow for the payment detection (15 s).
 */
export function runEvery(options: {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}): Loop {
  const { name, intervalMs, run } = options;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    const startedAt = Date.now();
    try {
      await run();
    } catch (error) {
      // A tick that fails never stops the loop: the next one tries again.
      log.error({ err: error, loop: name }, "loop.tick_failed");
    }
    const ms = Date.now() - startedAt;
    if (ms > intervalMs) log.warn({ loop: name, ms }, "loop.tick_slow");
    if (stopped) return;
    timer = setTimeout(
      () => {
        current = tick();
      },
      Math.max(0, intervalMs - ms),
    );
  }

  current = tick();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
