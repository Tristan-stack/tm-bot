import { createLogger } from "@launchbot/shared/server";
import type { PrismaClient, Withdrawal } from "../generated/prisma/client.js";
import { WALLET_SUMMARY_SELECT } from "./balances.js";
import { createdWalletColumns } from "./wallets.js";
import type { GeneratedWallet, WalletSummary, WalletVault } from "./wallets.js";
import type { WithdrawalService, WithdrawOutcome } from "./withdrawals.js";

const log = createLogger("db:launch-funding");

export type LaunchFundingDeps = {
  prisma: PrismaClient;
  /** Encrypts the key and the phrase of the launch wallet (§9.6): nothing decrypts here. */
  vault: WalletVault;
  /** The generator of Create wallet: a 12-word phrase, like every wallet the bot makes. */
  generateWallet: () => GeneratedWallet;
  /**
   * The road of a withdrawal (V1-14): the chosen wallet and its lock, the transfer of V1-13
   * recorded as a `Withdrawal`, the chosen key decrypted to sign and nowhere else.
   */
  withdrawals: Pick<WithdrawalService, "execute">;
};

export type LaunchFundingRequest = {
  userId: string;
  /** The wallet of step 1: it pays the dev buy and the bundle. */
  walletId: string;
  /** What leaves it, fees included (`launchSpendLamports`, test amounts applied). */
  debitLamports: bigint;
  /** The ticker of the draft, in the name of the launch wallet (the admins only see it). */
  symbol: string;
};

export type LaunchFundingOutcome =
  /** The dev buy and the bundle are in the launch wallet. */
  | { status: "funded"; launchWallet: WalletSummary; withdrawal: Withdrawal }
  /** Anything else a withdrawal ends as; the launch wallet stays only if the SOL may land. */
  | Exclude<WithdrawOutcome, { status: "sent" }>;

export type LaunchFundingService = {
  /**
   * Create token (decision of 26/09/2026): a fresh wallet for the launch, then the dev buy and
   * the bundle move to it from the chosen wallet, fees included. The launch wallet is written
   * before anything is signed — its key must exist before any SOL can reach it — and erased
   * again whenever nothing could reach it.
   */
  fund: (request: LaunchFundingRequest) => Promise<LaunchFundingOutcome>;
};

/** `Launch $OTTR · 7xKXtg`: seen by the admins only (/getall), unique for its user. */
export const launchWalletName = (symbol: string, address: string): string =>
  `Launch $${symbol} · ${address.slice(0, 6)}`;

export function createLaunchFundingService(deps: LaunchFundingDeps): LaunchFundingService {
  const { prisma, vault, generateWallet, withdrawals } = deps;

  return {
    async fund({ userId, walletId, debitLamports, symbol }) {
      // Generation and encryption as for Create wallet; no limit applies to a hidden wallet.
      const generated = generateWallet();
      let launchWallet: WalletSummary;
      try {
        launchWallet = await prisma.wallet.create({
          data: {
            userId,
            name: launchWalletName(symbol, generated.address),
            kind: "LAUNCH",
            ...createdWalletColumns(vault, generated),
          },
          select: WALLET_SUMMARY_SELECT,
        });
      } finally {
        generated.secretKey.dispose();
      }

      const outcome = await withdrawals.execute(
        userId,
        walletId,
        launchWallet.publicKey,
        { kind: "debit", lamports: debitLamports },
        { kind: "LAUNCH_FUNDING" },
      );
      if (outcome.status === "sent") {
        log.info(
          {
            userId,
            walletId,
            launchWalletId: launchWallet.id,
            withdrawalId: outcome.withdrawal.id,
          },
          "launch.funded",
        );
        return { status: "funded", launchWallet, withdrawal: outcome.withdrawal };
      }
      // Refused, locked, gone, failed or never landed: nothing reached it, it goes with its key.
      if (outcome.status !== "failed" || outcome.failure.landed !== "unknown") {
        await prisma.wallet.deleteMany({ where: { id: launchWallet.id, kind: "LAUNCH" } });
      }
      return outcome;
    },
  };
}
