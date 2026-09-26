import type { LaunchSweepService } from "@launchbot/db";
import { createLogger } from "@launchbot/shared/server";

const log = createLogger("worker:launch-wallets");

export type LaunchWalletsReport = {
  due: number;
  /** Emptied and erased with their key. */
  erased: number;
  /** Confirmed transfers to the treasury at this pass. */
  swept: number;
  /** A transfer in flight, a read or a transfer failed, SOL arrived: tried again next minute. */
  kept: number;
  failed: number;
};

/**
 * One pass of `launch.sweep-wallets`, every minute (decision of 26/09/2026): each launch wallet
 * funded a minute ago or more, one at a time, its SOL to the treasury, then its erasure. Nobody
 * is told.
 */
export async function runLaunchWalletsJob(
  launchWallets: LaunchSweepService,
  at: Date,
): Promise<LaunchWalletsReport> {
  const report: LaunchWalletsReport = { due: 0, erased: 0, swept: 0, kept: 0, failed: 0 };
  for (const walletId of await launchWallets.listDue(at)) {
    report.due += 1;
    try {
      const outcome = await launchWallets.sweepLaunchWallet(walletId);
      if (outcome.status === "NOT_FOUND") continue;
      report.swept += outcome.transfers.length;
      report[outcome.status === "ERASED" ? "erased" : "kept"] += 1;
    } catch (error) {
      report.failed += 1;
      log.error({ err: error, walletId }, "launch.wallet_failed");
    }
  }
  // A pass with nothing due, nearly every minute, says nothing.
  if (report.due > 0) log.info(report, "launch.pass");
  return report;
}
