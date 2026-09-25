import {
  effectiveStatus,
  GETALL_PURCHASES,
  GETALL_SUBSCRIPTIONS,
  GETALL_WITHDRAWALS,
  getPlanFeatures,
} from "@launchbot/shared";
import type { PaymentStatus, PlanStatus } from "@launchbot/shared";
import type { WalletSecretsRow } from "@launchbot/solana";
import type {
  Plan,
  PlanDuration,
  Prisma,
  PrismaClient,
  User,
  WalletSource,
  WithdrawalKind,
  WithdrawalStatus,
} from "../generated/prisma/client.js";
import { createAiQuotaStore } from "./ai-generations.js";
import { WALLET_SUMMARY_SELECT } from "./balances.js";
import { getPlanStatus } from "./subscriptions.js";
import { findUserByTelegramId } from "./user.js";

// What the admin commands of the support read (§11.4, V1-43): /whois and /getall. Every select
// is explicit and none reads a key column (§9.6) — but `walletSecrets`, for Reveal keys only.

/** An invoice as the support reads it, by its effective status: PENDING past its 30 min is EXPIRED. */
export type SupportPayment = {
  plan: Plan;
  duration: PlanDuration;
  /** `179.00`, frozen on the invoice. */
  priceUsd: string;
  expectedLamports: bigint;
  receivedLamports: bigint;
  depositAddress: string;
  status: PaymentStatus;
  createdAt: Date;
};

/** A period of a plan; ACTIVE past its end reads EXPIRED, whatever the expiry job did. */
export type SupportSubscription = {
  plan: Plan;
  duration: PlanDuration;
  status: "ACTIVE" | "EXPIRED";
  startsAt: Date;
  expiresAt: Date;
  /** From a paid invoice; `false` for a /grant. */
  fromPayment: boolean;
};

export type SupportWallet = {
  id: string;
  name: string;
  publicKey: string;
  source: WalletSource;
  createdAt: Date;
};

export type SupportWithdrawal = {
  createdAt: Date;
  kind: WithdrawalKind;
  /** `null`: the wallet was deleted since. */
  walletName: string | null;
  fromAddress: string;
  toAddress: string;
  lamports: bigint;
  status: WithdrawalStatus;
  error: string | null;
  signature: string | null;
};

export type UserSupportData = {
  user: User;
  plan: PlanStatus;
  /** The periods before the one `plan` shows, latest first. */
  history: SupportSubscription[];
  /** The latest invoices, `paymentCount` in all. */
  payments: SupportPayment[];
  paymentCount: number;
  /** Oldest first, as the wallet list of the user (§9.1). */
  wallets: SupportWallet[];
  /** The withdrawals of the user and the sweeps of an inactive account, latest first. */
  withdrawals: SupportWithdrawal[];
  drafts: number;
  simulations: number;
  /** AI Generate of the UTC day (D9); `null` without an active Premium. */
  aiToday: number | null;
};

/** The key columns a Reveal decrypts, and what its message names: /getall only (V1-43). */
export type WalletSecretsData = WalletSecretsRow & { id: string; name: string };

export type SupportDataService = {
  findUser: (telegramId: bigint) => Promise<User | null>;
  findUserById: (userId: string) => Promise<User | null>;
  loadUserSupportData: (user: User, now: Date) => Promise<UserSupportData>;
  /** The transfers of an account deleted for inactivity (V1-45), found by its Telegram id. */
  inactivitySweeps: (telegramId: bigint) => Promise<SupportWithdrawal[]>;
  /** The encrypted keys of the wallets of a user, oldest first: Reveal keys of /getall only. */
  walletSecrets: (userId: string) => Promise<WalletSecretsData[]>;
};

const PAYMENT_SELECT = {
  plan: true,
  duration: true,
  priceUsd: true,
  expectedLamports: true,
  receivedLamports: true,
  depositAddress: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const satisfies Prisma.PaymentSelect;

const WITHDRAWAL_SELECT = {
  createdAt: true,
  kind: true,
  fromAddress: true,
  toAddress: true,
  lamports: true,
  status: true,
  error: true,
  signature: true,
  wallet: { select: { name: true } },
} as const satisfies Prisma.WithdrawalSelect;

type WithdrawalRow = Prisma.WithdrawalGetPayload<{ select: typeof WITHDRAWAL_SELECT }>;

const withdrawalOf = ({ wallet, ...row }: WithdrawalRow): SupportWithdrawal => ({
  ...row,
  walletName: wallet?.name ?? null,
});

export function createSupportDataService(deps: { prisma: PrismaClient }): SupportDataService {
  const { prisma } = deps;
  const aiQuota = createAiQuotaStore({ prisma });

  return {
    findUser: (telegramId) => findUserByTelegramId(prisma, telegramId),
    findUserById: (userId) => prisma.user.findUnique({ where: { id: userId } }),

    async loadUserSupportData(user, now) {
      const userId = user.id;
      const [plan, periods, payments, paymentCount, wallets, withdrawals, drafts, simulations] =
        await Promise.all([
          getPlanStatus(prisma, userId, now),
          // One more than shown: the period of the plan line is left out of the history. The
          // order of `getPlanStatus`, so that period is the first row.
          prisma.subscription.findMany({
            where: { userId },
            orderBy: { expiresAt: "desc" },
            take: GETALL_SUBSCRIPTIONS + 1,
            select: {
              plan: true,
              duration: true,
              status: true,
              startsAt: true,
              expiresAt: true,
              paymentId: true,
            },
          }),
          prisma.payment.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: GETALL_PURCHASES,
            select: PAYMENT_SELECT,
          }),
          prisma.payment.count({ where: { userId } }),
          prisma.wallet.findMany({
            where: { userId },
            orderBy: { createdAt: "asc" },
            select: { ...WALLET_SUMMARY_SELECT, source: true },
          }),
          // Not the transfers of the deposit addresses (V1-33): they are not the user's.
          prisma.withdrawal.findMany({
            where: { userId, kind: { in: ["USER", "INACTIVITY_SWEEP"] } },
            orderBy: { createdAt: "desc" },
            take: GETALL_WITHDRAWALS,
            select: WITHDRAWAL_SELECT,
          }),
          prisma.tokenDraft.count({ where: { userId } }),
          prisma.simulation.count({ where: { userId } }),
        ]);

      const premium = plan.kind === "ACTIVE" && getPlanFeatures(plan.subscription.plan).aiGenerate;
      const aiToday = premium ? await aiQuota.countText(userId, now) : null;

      const history = periods
        .slice(1)
        .map(({ paymentId, status, ...period }): SupportSubscription => ({
          ...period,
          status: status === "ACTIVE" && period.expiresAt > now ? "ACTIVE" : "EXPIRED",
          fromPayment: paymentId !== null,
        }));

      return {
        user,
        plan,
        history,
        payments: payments.map(({ expiresAt, priceUsd, ...payment }) => ({
          ...payment,
          priceUsd: priceUsd.toFixed(2),
          status: effectiveStatus({ status: payment.status, expiresAt }, now),
        })),
        paymentCount,
        wallets,
        withdrawals: withdrawals.map(withdrawalOf),
        drafts,
        simulations,
        aiToday,
      };
    },

    inactivitySweeps: async (telegramId) =>
      (
        await prisma.withdrawal.findMany({
          where: { kind: "INACTIVITY_SWEEP", userTelegramId: telegramId },
          orderBy: { createdAt: "desc" },
          take: GETALL_WITHDRAWALS,
          select: WITHDRAWAL_SELECT,
        })
      ).map(withdrawalOf),

    walletSecrets: (userId) =>
      prisma.wallet.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          publicKey: true,
          source: true,
          encSecretKey: true,
          iv: true,
          authTag: true,
          encMnemonic: true,
          mnemonicIv: true,
          mnemonicAuthTag: true,
        },
      }),
  };
}
