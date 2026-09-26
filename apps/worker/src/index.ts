import {
  assertDatabaseReachable,
  createAccountDeletionService,
  createDataCleanupService,
  createInactiveAccountsService,
  createLaunchSweepService,
  createPaymentService,
  createReminderService,
  createSubscriptionService,
  createTreasuryService,
  prisma,
} from "@launchbot/db";
import {
  createUi,
  DATA_CLEANUP_CRON,
  DEPOSIT_KEY_PURGE_CRON,
  DEPOSIT_WATCH_CRON,
  EVERY_MINUTE_CRON,
  getWithdrawFeeBudgetLamports,
  INACTIVITY_CHECK_INTERVAL_MS,
  NOTIFY_RETRY_LIMIT,
  PAYMENT_CHECK_INTERVAL_MS,
  SWEEP_RETRY_DELAY_SEC,
  SWEEP_RETRY_LIMIT,
  WORKER_STOP_TIMEOUT_MS,
} from "@launchbot/shared";
import { createLogger, loadEnv, runEvery } from "@launchbot/shared/server";
import type { Loop, Service } from "@launchbot/shared/server";
import {
  assertDevnet,
  createKeyVault,
  createTransferApi,
  findLastSender,
  generateKeypair,
  getBalancesFresh,
  getSolanaRpc,
  rpcHost,
} from "@launchbot/solana";
import type { PgBoss } from "pg-boss";
import { createBoss, cronEvery, QUEUES, scheduleCron, workQueue } from "./boss.js";
import { createDepositJobs } from "./jobs/deposits.js";
import { runLaunchWalletsJob } from "./jobs/launch-wallets.js";
import { detectPayments, notifyPaid } from "./jobs/payments.js";
import { createRetentionJobs } from "./jobs/retention.js";
import { createSubscriptionJobs } from "./jobs/subscriptions.js";
import { createLeaderLock } from "./leader-lock.js";
import type { LeaderLock } from "./leader-lock.js";
import { createTelegramApi, createTelegramSender } from "./telegram.js";

const log = createLogger("worker");

type PaymentJob = { paymentId: string };

/**
 * The worker (§12): the payment loop every 15 s (V1-32), the transfers of the deposits to the
 * treasury (V1-33), the plans' reminders and expiry (V1-34), the inactive accounts and the 90
 * days of the data (V1-45), the sweep of the launch wallets (decision of 26/09/2026), on
 * pg-boss. The whole startup runs inside `start()`: configuration, devnet guard, database,
 * Telegram, jobs, then the loop.
 */
export function createWorkerService(): Service {
  let boss: PgBoss | undefined;
  let lock: LeaderLock | undefined;
  let loop: Loop | undefined;

  return {
    name: "worker",
    async start() {
      const env = loadEnv();

      // The worker signs the transfers of the deposits: the guard of the bot, fail closed.
      log.info({ rpcHost: rpcHost(env.SOLANA_RPC_URL) }, "Verifying the cluster");
      await assertDevnet({ cluster: env.SOLANA_CLUSTER, rpcUrl: env.SOLANA_RPC_URL });
      await assertDatabaseReachable(prisma);
      const api = createTelegramApi(env.BOT_TOKEN);
      try {
        await api.getMe();
      } catch (error) {
        throw new Error("Refusing to start: BOT_TOKEN rejected by Telegram.", { cause: error });
      }

      const ui = createUi(env.SOLANA_CLUSTER);
      const now = () => new Date();
      const rpc = getSolanaRpc(env.SOLANA_RPC_URL);
      const readLamports = (addresses: readonly string[]) => getBalancesFresh(rpc, addresses);
      // The one vault of the process: only the worker decrypts a deposit key, to sign (§9.6).
      const vault = createKeyVault(env.WALLET_ENCRYPTION_KEY);
      const subscriptions = createSubscriptionService({ prisma });
      const payments = createPaymentService({
        prisma,
        subscriptions,
        // The worker makes no invoice: no price, and its keypair and vault are never used.
        getSolUsdPrice: () => Promise.resolve(null),
        readLamports,
        generateKeypair,
        vault,
      });
      const transfer = createTransferApi(env);
      const feeBudgetLamports = getWithdrawFeeBudgetLamports(env.PRIORITY_FEE_MAX_MICROLAMPORTS);
      // Every transfer to the treasury: the deposits, the accounts, the launch wallets.
      const sweepDeps = {
        prisma,
        transfer,
        vault,
        readLamports,
        treasury: env.TREASURY_WALLET,
        feeBudgetLamports,
      };
      const treasury = createTreasuryService({
        ...sweepDeps,
        findSender: (address) => findLastSender(rpc, address),
      });
      const telegram = createTelegramSender({ api, adminIds: env.ADMIN_TELEGRAM_IDS });
      await warnIfTreasuryEmpty(readLamports, env.TREASURY_WALLET);
      // V1-45: the SOL of an inactive account goes to the treasury before the account goes.
      const retention = createRetentionJobs({
        accounts: createInactiveAccountsService({
          ...sweepDeps,
          deletion: createAccountDeletionService({ prisma, readLamports, feeBudgetLamports }),
        }),
        cleanup: createDataCleanupService({ prisma }),
        adminIds: env.ADMIN_TELEGRAM_IDS,
        telegram,
        ui,
        now,
      });
      const inactiveCron = cronEvery(INACTIVITY_CHECK_INTERVAL_MS);
      const launchWallets = createLaunchSweepService(sweepDeps);

      const started = await createBoss(env.DATABASE_URL);
      boss = started;
      const enqueue = (queue: string) => (paymentId: string) =>
        started.send(queue, { paymentId }, { singletonKey: paymentId });
      const enqueueSweep = enqueue(QUEUES.sweep);

      const deposits = createDepositJobs({ treasury, telegram, ui, enqueueSweep, now });
      const plans = createSubscriptionJobs({
        reminders: createReminderService({ prisma }),
        subscriptions,
        telegram,
        ui,
        now,
      });
      await workQueue<PaymentJob>(
        started,
        QUEUES.notifyPaid,
        { retryLimit: NOTIFY_RETRY_LIMIT, retryBackoff: true },
        (job) => notifyPaid({ payments, telegram, ui, now }, job.data.paymentId),
      );
      await workQueue<PaymentJob>(
        started,
        QUEUES.sweep,
        { retryLimit: SWEEP_RETRY_LIMIT, retryDelay: SWEEP_RETRY_DELAY_SEC, retryBackoff: true },
        (job) =>
          deposits.sweep({ ...job.data, retryCount: job.retryCount, retryLimit: job.retryLimit }),
      );
      await scheduleCron(started, QUEUES.sweepPaid, EVERY_MINUTE_CRON, deposits.sweepPaid);
      await scheduleCron(started, QUEUES.watch, DEPOSIT_WATCH_CRON, deposits.watch);
      await scheduleCron(started, QUEUES.purgeKeys, DEPOSIT_KEY_PURGE_CRON, deposits.purgeKeys);
      await scheduleCron(started, QUEUES.remind, EVERY_MINUTE_CRON, plans.remind);
      await scheduleCron(started, QUEUES.expire, EVERY_MINUTE_CRON, plans.expire);
      await scheduleCron(
        started,
        QUEUES.inactiveAccounts,
        inactiveCron,
        retention.inactiveAccounts,
      );
      await scheduleCron(started, QUEUES.cleanup, DATA_CLEANUP_CRON, retention.cleanup);
      await scheduleCron(started, QUEUES.launchWallets, EVERY_MINUTE_CRON, () =>
        runLaunchWalletsJob(launchWallets, now()),
      );

      // One worker runs the loop; another one waits for the lock, its jobs still work.
      const leader = createLeaderLock({
        connectionString: env.DATABASE_URL,
        key: "worker:payments",
      });
      lock = leader;
      // V1-33: the funds of an invoice the worker activated move at once.
      const detection = {
        payments,
        afterActivation: [enqueue(QUEUES.notifyPaid), enqueueSweep],
        now,
      };
      loop = runEvery({
        name: "payments",
        intervalMs: PAYMENT_CHECK_INTERVAL_MS,
        run: async () => {
          if (!(await leader.acquire())) return;
          const startedAt = Date.now();
          const report = await detectPayments(detection);
          log.debug({ ...report, ms: Date.now() - startedAt }, "payments.tick");
        },
      });
      log.info("Worker started");
    },

    // The loop finishes its tick, the lock goes, then the jobs in progress get 30 s.
    async stop() {
      await loop?.stop();
      await lock?.release();
      await boss?.stop({ graceful: true, timeout: WORKER_STOP_TIMEOUT_MS });
    },
  };
}

/**
 * A transfer under the rent-exempt minimum to an account that does not exist fails (§9.5):
 * the treasury must be funded once. A warning, not a refusal.
 */
async function warnIfTreasuryEmpty(
  readLamports: (addresses: readonly string[]) => Promise<Map<string, bigint>>,
  treasury: string,
): Promise<void> {
  try {
    const lamports = (await readLamports([treasury])).get(treasury) ?? 0n;
    if (lamports === 0n) {
      log.warn("TREASURY_WALLET has no account yet: send it SOL once");
    }
  } catch (error) {
    log.warn({ err: error }, "TREASURY_WALLET could not be read");
  }
}
