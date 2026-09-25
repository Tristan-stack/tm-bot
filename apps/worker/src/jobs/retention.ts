import type {
  CandidateCursor,
  CleanupReport,
  DataCleanupService,
  InactiveAccountsService,
} from "@launchbot/db";
import {
  buildInactiveRefundAlert,
  INACTIVE_ACCOUNTS_PAGE_SIZE,
  inactivityCutoff,
  isInactiveCandidate,
} from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { CronJobData } from "../boss.js";
import type { TelegramSender } from "../telegram.js";

const log = createLogger("worker:retention");

export type RetentionJobsDeps = {
  accounts: InactiveAccountsService;
  cleanup: DataCleanupService;
  /** `ADMIN_TELEGRAM_IDS`: the only accounts never deleted for inactivity. */
  adminIds: readonly number[];
  telegram: Pick<TelegramSender, "notifyAdmins">;
  ui: Ui;
  now: () => Date;
};

export type InactiveAccountsReport = {
  scanned: number;
  deleted: number;
  /** Back since, or SOL arrived since: kept, nothing failed. */
  kept: number;
  /** Confirmed transfers to the treasury at this pass. */
  swept: number;
  /** Kept by a read, a transfer or an error: tried again at the next pass. */
  failed: number;
};

/**
 * One pass of `accounts.delete-inactive` (§11.2, §11.3, decision of 16/09/2026): the transfers
 * a crash left PENDING first, then every account inactive for `INACTIVITY_DELETE_MS` (24 h), by
 * pages of 100 on a cursor, one at a time. Nobody is told, but the admins when a user came back
 * after their SOL left.
 */
export async function runInactiveAccountsJob(
  deps: Omit<RetentionJobsDeps, "cleanup" | "now">,
  at: Date,
): Promise<InactiveAccountsReport> {
  const { accounts, adminIds, telegram, ui } = deps;
  // Fixed at the start of the pass: an account active since then is kept.
  const cutoff = inactivityCutoff(at);
  const pending = await accounts.resolvePendingSweeps();
  const report: InactiveAccountsReport = { scanned: 0, deleted: 0, kept: 0, swept: 0, failed: 0 };

  let after: CandidateCursor | undefined;
  do {
    const page = await accounts.listCandidates(cutoff, adminIds, after);
    for (const user of page) {
      // The rule once more, in code: an admin is never touched, whatever the query says.
      if (!isInactiveCandidate(user, { now: at, adminIds })) continue;
      report.scanned += 1;
      try {
        const outcome = await accounts.processAccount(user, cutoff);
        if (outcome.status === "NOT_FOUND") continue;
        report.swept += outcome.transfers.length;
        if (outcome.status === "DELETED") {
          report.deleted += 1;
        } else if (outcome.status === "ACTIVE" || outcome.reason === "FUNDS_LEFT") {
          report.kept += 1;
        } else {
          report.failed += 1;
        }
        // The account stays with empty wallets: an admin refunds what moved (proposal).
        if (outcome.status === "ACTIVE" && outcome.transfers.length > 0) {
          await telegram.notifyAdmins(
            buildInactiveRefundAlert(ui, { user, transfers: outcome.transfers }),
          );
        }
      } catch (error) {
        report.failed += 1;
        log.error({ err: error, userId: user.id }, "inactive.account_failed");
      }
    }
    after = page.length === INACTIVE_ACCOUNTS_PAGE_SIZE ? page.at(-1) : undefined;
  } while (after !== undefined);

  log.info({ ...report, pending }, "inactive.pass");
  return report;
}

/** The clock of a run: its own, or the one of a launch by hand (`--now`). */
function clockOf(data: CronJobData, now: () => Date): Date {
  if (data.now === undefined) return now();
  const at = new Date(data.now);
  if (Number.isNaN(at.getTime())) throw new Error("The clock of a manual run is not a date");
  return at;
}

/** The two crons of the data retention (V1-45), the job data of a launch by hand included. */
export function createRetentionJobs(deps: RetentionJobsDeps) {
  const { cleanup, now } = deps;
  return {
    /** `accounts.delete-inactive`, every 15 minutes. */
    inactiveAccounts: async (data: CronJobData): Promise<InactiveAccountsReport> =>
      runInactiveAccountsJob(deps, clockOf(data, now)),
    /** `data.expired-cleanup`, daily at 03:30 UTC. */
    cleanup: async (data: CronJobData): Promise<CleanupReport> =>
      cleanup.runExpiredCleanup(clockOf(data, now)),
  };
}
