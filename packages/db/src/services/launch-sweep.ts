import { LAUNCH_SWEEP_FALLBACK_MS, LAUNCH_WALLET_ABANDONED_MS } from "@launchbot/shared";
import type { SweptTransfer } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { createAccountSweeper } from "./account-sweep.js";
import type { AccountSweeperDeps, KeptSweep } from "./account-sweep.js";
import { WALLET_SIGNER_SELECT } from "./withdrawals.js";

// The sweep of a launch wallet (decision of 26/09/2026): when the chart of the launch ends (the
// bot), or `LAUNCH_SWEEP_FALLBACK_MS` after its funding (the worker), what it holds goes to the
// treasury (account-sweep.ts, kind LAUNCH_SWEEP, kept with the Telegram id for a refund by
// hand), then it is erased with its key. Nothing is erased while a transfer to it or from it
// may still land.

const log = createLogger("db:launch-sweep");

export type LaunchSweepOutcome =
  /** Nothing left worth moving: the wallet and its key are gone. */
  | { status: "ERASED"; transfers: SweptTransfer[] }
  /** Tried again at the next pass. */
  | KeptSweep
  | { status: "NOT_FOUND" };

export type LaunchSweepService = {
  /**
   * The launch wallets whose funding went out `LAUNCH_SWEEP_FALLBACK_MS` ago or more, oldest
   * first; and those no funding was recorded for after `LAUNCH_WALLET_ABANDONED_MS`.
   */
  listDue: (at: Date) => Promise<string[]>;
  /** One launch wallet: what it holds to the treasury, then its erasure. */
  sweepLaunchWallet: (walletId: string) => Promise<LaunchSweepOutcome>;
};

export function createLaunchSweepService(deps: AccountSweeperDeps): LaunchSweepService {
  const { prisma } = deps;
  const sweeper = createAccountSweeper(deps);

  return {
    async listDue(at) {
      const due = new Date(at.getTime() - LAUNCH_SWEEP_FALLBACK_MS);
      const wallets = await prisma.wallet.findMany({
        where: { kind: "LAUNCH", createdAt: { lte: due } },
        orderBy: { createdAt: "asc" },
        select: { id: true, publicKey: true, createdAt: true },
      });
      if (wallets.length === 0) return [];
      const fundings = await prisma.withdrawal.findMany({
        where: {
          kind: "LAUNCH_FUNDING",
          toAddress: { in: wallets.map((wallet) => wallet.publicKey) },
          createdAt: { lte: due },
        },
        select: { toAddress: true },
      });
      const funded = new Set(fundings.map((row) => row.toAddress));
      const abandoned = new Date(at.getTime() - LAUNCH_WALLET_ABANDONED_MS);
      return wallets
        .filter((wallet) => funded.has(wallet.publicKey) || wallet.createdAt <= abandoned)
        .map((wallet) => wallet.id);
    },

    async sweepLaunchWallet(walletId) {
      const found = await prisma.wallet.findFirst({
        where: { id: walletId, kind: "LAUNCH" },
        select: { ...WALLET_SIGNER_SELECT, user: { select: { id: true, telegramId: true } } },
      });
      if (found === null) return { status: "NOT_FOUND" };
      const { user, ...wallet } = found;

      const swept = await sweeper.sweepWallets(user, [wallet], { kind: "LAUNCH_SWEEP" });
      if (swept.status === "KEPT") return swept;
      await prisma.wallet.deleteMany({ where: { id: walletId, kind: "LAUNCH" } });
      log.info(
        { userId: user.id, walletId, transfers: swept.transfers.length },
        "launch.wallet_erased",
      );
      return { status: "ERASED", transfers: swept.transfers };
    },
  };
}
