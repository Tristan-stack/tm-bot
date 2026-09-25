import type { TreasuryService } from "@launchbot/db";
import { buildDepositAlert } from "@launchbot/shared";
import type { DepositAlert, Ui } from "@launchbot/shared";
import type { TelegramSender } from "../telegram.js";

/** What the sweep job knows of its own attempts (pg-boss metadata). */
export type SweepJob = { paymentId: string; retryCount: number; retryLimit: number };

export type DepositJobsDeps = {
  treasury: TreasuryService;
  telegram: Pick<TelegramSender, "notifyAdmins">;
  ui: Ui;
  /** `deposits.sweep` for this invoice; a job already queued for it absorbs this one. */
  enqueueSweep: (paymentId: string) => Promise<unknown>;
  now: () => Date;
};

/**
 * The jobs of the deposit addresses (§8.3, §11.3, V1-33). The treasury service decides and
 * records; here, the queue and the admins.
 */
export function createDepositJobs(deps: DepositJobsDeps) {
  const { treasury, telegram, ui, enqueueSweep, now } = deps;

  const alert = (message: DepositAlert) => telegram.notifyAdmins(buildDepositAlert(ui, message));

  const enqueueAll = async (paymentIds: readonly string[]) => {
    for (const paymentId of paymentIds) await enqueueSweep(paymentId);
  };

  return {
    /**
     * `deposits.sweep`: one transfer, the alert of its case after it. Not done (still in
     * flight, or failed) → the job throws and pg-boss retries with its backoff; the last attempt
     * tells the admins once, then fails (the next cron pass sends a new job, silent).
     */
    async sweep(job: SweepJob): Promise<void> {
      const result = await treasury.sweepDeposit(job.paymentId);
      if (result.kind === "SWEPT") {
        if (result.alert !== null) await alert(result.alert);
        return;
      }
      if (result.kind === "NOTHING_TO_SWEEP") return;
      const reason = result.kind === "IN_FLIGHT" ? "IN_FLIGHT" : result.reason;
      if (job.retryCount >= job.retryLimit) {
        const failed = await treasury.failureAlert(job.paymentId, reason, job.retryCount + 1);
        if (failed !== null) await alert(failed);
      }
      throw new Error(`Deposit not moved: ${reason}`);
    },

    /** `deposits.sweep-paid`, every minute: the activations of the bot (V1-30, V1-31) too. */
    sweepPaid: async () => enqueueAll(await treasury.listPaidToSweep()),

    /** `deposits.watch`, every 5 minutes: funds on addresses past their 24 h. */
    watch: async () => enqueueAll(await treasury.watch(now())),

    /** `deposits.purge-keys`, daily: the keys past their 30 days. */
    purgeKeys: async (): Promise<void> => {
      const purge = await treasury.purgeKeys(now());
      await enqueueAll(purge.sweep);
      for (const message of purge.alerts) await alert(message);
    },
  };
}
