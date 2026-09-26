import { autoRetry } from "@grammyjs/auto-retry";
import { conversations } from "@grammyjs/conversations";
import type { ConversationData, VersionedState } from "@grammyjs/conversations";
import { PrismaAdapter } from "@grammyjs/storage-prisma";
import {
  assertDatabaseReachable,
  createAccountDeletionService,
  createAccountSweeper,
  createAiQuotaStore,
  createLaunchFundingService,
  createPaymentService,
  createSensitiveMessageStore,
  createSimulationStore,
  createSubscriptionService,
  createSupportDataService,
  createTokenDraftService,
  createWalletPaymentService,
  createWalletService,
  createWithdrawalService,
  prisma as defaultPrisma,
} from "@launchbot/db";
import type {
  AiQuotaStore,
  LaunchFundingService,
  PrismaClient,
  SimulationStore,
  TokenDraftService,
  WalletPaymentService,
  WalletService,
  WithdrawalService,
} from "@launchbot/db";
import {
  createUi,
  en,
  getWithdrawFeeBudgetLamports,
  SENSITIVE_SWEEP_INTERVAL_MS,
} from "@launchbot/shared";
import type { AiProviders } from "@launchbot/shared";
import {
  createLogger,
  createTelegramFileClient,
  createTokenImageService,
  loadEnv,
  runEvery,
} from "@launchbot/shared/server";
import type { Env, Loop, Service, TokenImageService } from "@launchbot/shared/server";
import {
  assertDevnet,
  createKeyVault,
  createTransferApi,
  generateKeypair,
  generateMnemonicWallet,
  getBalancesFresh,
  getSolanaRpc,
  parsePrivateKey,
  parseSeedPhrase,
  rpcHost,
} from "@launchbot/solana";
import { Bot, session } from "grammy";
import { initialSession } from "./context.js";
import type { BotContext } from "./context.js";
import { handleBotError } from "./errors.js";
import { createAccess } from "./features/access/access.js";
import { checkChannelRights } from "./features/access/startup-check.js";
import { registerAdmin, setAdminCommands } from "./features/admin/admin.js";
import type { AdminServices } from "./features/admin/admin.js";
import { createAdminGuard } from "./features/admin/guard.js";
import { registerHome } from "./features/home/home.js";
import { registerLaunch } from "./features/launch/launch.js";
import { registerSimulation } from "./features/simulation/simulation.js";
import { simTelegram } from "./features/simulation/telegram.js";
import type { InvoicePayments } from "./features/subscribe/invoice.js";
import { createSubscribe, registerSubscribe } from "./features/subscribe/subscribe.js";
import { registerSupport } from "./features/support/support.js";
import { createTokenStep } from "./features/token-step/token-step.js";
import { importConsumer } from "./features/wallets/import.js";
import { createWalletNav } from "./features/wallets/nav.js";
import { registerWallets } from "./features/wallets/wallets.js";
import { privateOnly } from "./middleware/private-only.js";
import { globalRateLimit } from "./middleware/rate-limit.js";
import { sensitiveMessageGuard } from "./middleware/sensitive-input.js";
import {
  CONVERSATION_KEY_PREFIX,
  createSessionStorage,
  saveSessionNow,
  sessionKeyOf,
} from "./middleware/session.js";
import { userActivity } from "./middleware/user-activity.js";
import { createInputRouter } from "./navigation/inputs.js";
import { ensureAnswered } from "./navigation/notify.js";
import { createCallbackRouter } from "./router/callback-router.js";
import { createAiGenerateService } from "./services/ai/ai-generate.js";
import { createAiProviders } from "./services/ai/providers.js";
import { createDataServices } from "./services/data.js";
import type { DataServices } from "./services/data.js";
import { sweepSensitiveMessages } from "./services/sensitive-sweeper.js";
import { createSimRunner } from "./services/sim-runner.js";
import type { SimRunner, SimRunnerDeps } from "./services/sim-runner.js";
import { createSimulationService } from "./services/simulation.js";

const log = createLogger("bot");

export type BotServiceOptions = {
  env?: Env;
  prisma?: PrismaClient;
  /** Injected in tests so the guard is exercised, never skipped. */
  getGenesisHash?: (rpcUrl: string) => Promise<string>;
};

/** Importing this module has no side effect: `main.ts` is what starts a process. */
export function createBot(
  env: Env,
  prisma: PrismaClient,
  /** Test seam: the real services read the RPC, the price provider and the tables. */
  options: {
    data?: DataServices;
    wallets?: WalletService;
    withdrawals?: WithdrawalService;
    payments?: InvoicePayments;
    walletPayments?: WalletPaymentService;
    drafts?: TokenDraftService;
    simulations?: SimulationStore;
    aiQuota?: AiQuotaStore;
    aiProviders?: AiProviders;
    /** The clock, the renderer and the cap of the simulation runner (tests). */
    simRunner?: Omit<SimRunnerDeps, "ui" | "telegram">;
    images?: TokenImageService;
    /** What the admin commands read and write (V1-42 to V1-44). */
    admin?: AdminServices;
    /** Create token: the funding of a launch wallet (decision of 26/09/2026). */
    launchFunding?: LaunchFundingService;
  } = {},
): { bot: Bot<BotContext>; simRunner: SimRunner } {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);
  const ui = createUi(env.SOLANA_CLUSTER);
  // One storage: the session middleware, and /announce, which writes its posts as they go.
  const sessions = createSessionStorage(prisma);
  const router = createCallbackRouter();
  const inputs = createInputRouter();
  const access = createAccess({ env, prisma, api: bot.api, ui });
  const data = options.data ?? createDataServices({ prisma, api: bot.api, env });
  // The one vault of the process: nothing else holds the master key.
  const vault = createKeyVault(env.WALLET_ENCRYPTION_KEY);
  const withdrawFeeBudgetLamports = getWithdrawFeeBudgetLamports(
    env.PRIORITY_FEE_MAX_MICROLAMPORTS,
  );
  const wallets =
    options.wallets ??
    createWalletService({
      prisma,
      balances: data,
      generateWallet: generateMnemonicWallet,
      parseSecret: { KEY: parsePrivateKey, SEED: parseSeedPhrase },
      vault,
      withdrawFeeBudgetLamports,
    });
  // The transfers of V1-13 on the connection the devnet guard verified, with the fee bounds of §12.
  const transfer = createTransferApi(env);
  const withdrawals =
    options.withdrawals ??
    createWithdrawalService({ prisma, balances: data, transfer, vault, withdrawFeeBudgetLamports });
  // Create token (decision of 26/09/2026): the dev buy and the bundle move to a fresh launch
  // wallet by the road of a withdrawal; test amounts on devnet.
  const launchDivisor = BigInt(env.LAUNCH_TEST_DIVISOR);
  const launchFunding =
    options.launchFunding ??
    createLaunchFundingService({
      prisma,
      vault,
      generateWallet: generateMnemonicWallet,
      withdrawals,
    });
  // Built here, not inside the section: the import input is consumed before the rate limit.
  const walletNav = createWalletNav({ ui, wallets, withdrawals, data });
  const providers = options.aiProviders ?? createAiProviders(env);
  const ai = createAiGenerateService({
    quota: options.aiQuota ?? createAiQuotaStore({ prisma }),
    providers,
    hasActivePremium: data.hasActivePremium,
  });
  // One step for both flows (§5): V1-22 and V1-37 register theirs, AI Generate serves both.
  const drafts = options.drafts ?? createTokenDraftService({ prisma });
  const tokenStep = createTokenStep({ ui, drafts, data, ai, providers });
  const simulationStore = options.simulations ?? createSimulationStore({ prisma });
  const simulations = createSimulationService({ store: simulationStore, data });
  // The simulations running in the chat (V1-26): one runner per process, stopped with the bot.
  const simRunner = createSimRunner({ ui, telegram: simTelegram(bot.api), ...options.simRunner });
  const images =
    options.images ??
    createTokenImageService(createTelegramFileClient({ botToken: env.BOT_TOKEN }));
  // The invoices (V1-28): the price of V1-07, a deposit read at `confirmed` on the connection
  // the devnet guard verified, a new key per invoice encrypted by the one vault.
  const rpc = getSolanaRpc(env.SOLANA_RPC_URL);
  const readLamports = (addresses: readonly string[]) => getBalancesFresh(rpc, addresses);
  const subscriptions = createSubscriptionService({ prisma });
  const payments =
    options.payments ??
    createPaymentService({
      prisma,
      subscriptions,
      getSolUsdPrice: data.getSolUsdPrice,
      readLamports,
      generateKeypair,
      vault,
    });
  const walletPayments =
    options.walletPayments ??
    createWalletPaymentService({ prisma, payments, balances: data, transfer, vault });
  // The offers (V1-29) and the invoice (V1-30, V1-31): Renew (V1-34) and Launch Coin (V1-35)
  // open the offers.
  const subscribe = createSubscribe({ ui, data, providers, payments, walletPayments });
  // The admin commands (§11.4, V1-38 to V1-44): the guard knows the ids of the environment.
  const guard = createAdminGuard(env.ADMIN_TELEGRAM_IDS);
  const admin = options.admin ?? {
    subscriptions,
    support: createSupportDataService({ prisma }),
    deletion: createAccountDeletionService({
      prisma,
      readLamports,
      feeBudgetLamports: withdrawFeeBudgetLamports,
    }),
    // /purge moves the SOL of the wallets to the treasury before the deletion (25/09/2026).
    sweeper: createAccountSweeper({
      prisma,
      transfer,
      vault,
      readLamports,
      treasury: env.TREASURY_WALLET,
      feeBudgetLamports: withdrawFeeBudgetLamports,
    }),
    sensitive: createSensitiveMessageStore({ prisma }),
  };

  // Waits on 429 Too Many Requests, within bounds: updates are handled one at a time, so an
  // unlimited retry would stall every user, and would hang the startup instead of failing it.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 10 }));

  // The order is imposed by the ticket: nothing touches the database before privateOnly.
  bot.use(privateOnly);
  // Wraps everything below: a click always gets its one answer, whatever handled it.
  bot.use(ensureAnswered);
  bot.use(userActivity(prisma));
  bot.use(session({ initial: initialSession, storage: sessions, getSessionKey: sessionKeyOf }));
  // §9.4: a key or a seed phrase leaves the chat before anything else runs. It needs the
  // session (the input it answers) and it must run before the rate limit, which would drop the
  // update without deleting it, and before the gate, which would answer with the channel screen.
  bot.use(sensitiveMessageGuard(importConsumer(walletNav)));
  bot.use(globalRateLimit);
  // No conversation and no menu before the channel is joined (§4.2).
  bot.use(access.gate);
  bot.use(
    conversations<BotContext, BotContext>({
      storage: {
        type: "key",
        prefix: CONVERSATION_KEY_PREFIX,
        adapter: new PrismaAdapter<VersionedState<ConversationData>>(prisma.session),
      },
    }),
  );

  access.register(router);
  registerHome(bot, router, access, { ui, env, data, launchDivisor });
  registerWallets(router, inputs, walletNav);
  registerSimulation(router, inputs, {
    ui,
    tokenStep,
    simulations,
    store: simulationStore,
    runner: simRunner,
    images,
  });
  tokenStep.mount(router, inputs);
  registerSubscribe(router, subscribe);
  // Launch Coin (V1-35 to V1-37): the menu button and « Payment received » (`lc:open`).
  registerLaunch(router, inputs, {
    ui,
    data,
    access,
    tokenStep,
    offers: subscribe,
    successUrl: env.CHANNEL_SUCCESS_URL,
    launchFunding,
    launchDivisor,
  });
  registerSupport(router, { ui, data, supportUrl: env.SUPPORT_URL });
  registerAdmin(router, inputs, {
    ...admin,
    ui,
    guard,
    data,
    vault,
    announce: {
      chatIds: { announcements: env.CHANNEL_ANNOUNCEMENTS_ID, botChannel: env.CHANNEL_BOT_ID },
      saveSession: (ctx) => saveSessionNow(sessions, ctx),
    },
  });
  // Admin commands, `adm:*` clicks and the message /announce waits for (V1-38), after the gate:
  // an admin joins the channel too.
  bot.use(guard.middleware());
  // The message that answers an input a screen waits for: a name, an address, an amount.
  bot.use(inputs.middleware());
  bot.use(router.middleware());

  bot.catch(handleBotError);
  return { bot, simRunner };
}

/**
 * The bot as a service of `runProcess`. The whole startup runs inside `start()`, in the order
 * of §12: configuration, devnet guard, database, Telegram, then polling. Any failure throws,
 * and `runProcess` logs it scrubbed and exits with code 1: no process runs half configured.
 */
export function createBotService(options: BotServiceOptions = {}): Service {
  let bot: Bot<BotContext> | undefined;
  let simRunner: SimRunner | undefined;
  let sweeper: Loop | undefined;

  return {
    name: "bot",
    async start() {
      const env = options.env ?? loadEnv();
      const prisma = options.prisma ?? defaultPrisma;

      // Fails closed, and logs only the host: an RPC query string can hold an API key.
      log.info({ rpcHost: rpcHost(env.SOLANA_RPC_URL) }, "Verifying the cluster");
      await assertDevnet({
        cluster: env.SOLANA_CLUSTER,
        rpcUrl: env.SOLANA_RPC_URL,
        getGenesisHash: options.getGenesisHash,
      });

      await assertDatabaseReachable(prisma);

      ({ bot, simRunner } = createBot(env, prisma));
      try {
        await bot.init();
      } catch (error) {
        // `cause` is never logged: the logger keeps the name and the message of an error only.
        throw new Error("Refusing to start: BOT_TOKEN rejected by Telegram.", { cause: error });
      }
      await checkChannelRights(bot.api, bot.botInfo.id, env);
      await bot.api.setMyCommands([{ command: "start", description: en.home.command }], {
        scope: { type: "all_private_chats" },
      });
      await setAdminCommands(bot.api, env.ADMIN_TELEGRAM_IDS);

      // The messages holding wallet keys (V1-43): at startup, then every 5 s, so one sent before a
      // restart is still deleted.
      const api = bot.api;
      const store = createSensitiveMessageStore({ prisma });
      sweeper = runEvery({
        name: "sensitive-messages",
        intervalMs: SENSITIVE_SWEEP_INTERVAL_MS,
        run: async () => {
          await sweepSensitiveMessages({ store, api });
        },
      });

      // `bot.start` deletes the webhook itself, then polls until `stop`: it is not awaited.
      void bot.start({
        allowed_updates: ["message", "edited_message", "callback_query"],
        onStart: (info) => log.info({ username: info.username }, "Long polling started"),
      });
    },
    // The simulations stop first (their messages stay), then the update being handled finishes,
    // then the sweeper ends its pass.
    stop: async () => {
      simRunner?.stop();
      await bot?.stop();
      await sweeper?.stop();
    },
  };
}
