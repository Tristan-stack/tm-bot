import { autoRetry } from "@grammyjs/auto-retry";
import { conversations } from "@grammyjs/conversations";
import type { ConversationData, VersionedState } from "@grammyjs/conversations";
import { PrismaAdapter } from "@grammyjs/storage-prisma";
import {
  createAiQuotaStore,
  createTokenDraftService,
  createWalletService,
  createWithdrawalService,
  prisma as defaultPrisma,
} from "@launchbot/db";
import type {
  AiQuotaStore,
  PrismaClient,
  TokenDraftService,
  WalletService,
  WithdrawalService,
} from "@launchbot/db";
import { createUi, en, getWithdrawFeeBudgetLamports } from "@launchbot/shared";
import type { AiProviders } from "@launchbot/shared";
import { createLogger, loadEnv } from "@launchbot/shared/server";
import type { Env, Service } from "@launchbot/shared/server";
import {
  assertDevnet,
  createKeyVault,
  generateMnemonicWallet,
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
import { registerComingSoon } from "./features/home/coming-soon.js";
import { registerHome } from "./features/home/home.js";
import { registerSimulationProvisional } from "./features/simulation/provisional.js";
import { createTokenStep } from "./features/token-step/token-step.js";
import { importConsumer } from "./features/wallets/import.js";
import { createWalletNav } from "./features/wallets/nav.js";
import { registerWallets } from "./features/wallets/wallets.js";
import { privateOnly } from "./middleware/private-only.js";
import { globalRateLimit } from "./middleware/rate-limit.js";
import { sensitiveMessageGuard } from "./middleware/sensitive-input.js";
import { CONVERSATION_KEY_PREFIX, createSessionStorage } from "./middleware/session.js";
import { userActivity } from "./middleware/user-activity.js";
import { createInputRouter } from "./navigation/inputs.js";
import { ensureAnswered } from "./navigation/notify.js";
import { createCallbackRouter } from "./router/callback-router.js";
import { createAiGenerateService } from "./services/ai/ai-generate.js";
import { createAiProviders } from "./services/ai/providers.js";
import { createDataServices } from "./services/data.js";
import type { DataServices } from "./services/data.js";
import { createTransferApi } from "./services/transfer.js";

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
    drafts?: TokenDraftService;
    aiQuota?: AiQuotaStore;
    aiProviders?: AiProviders;
  } = {},
): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);
  const ui = createUi(env.SOLANA_CLUSTER);
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
  const withdrawals =
    options.withdrawals ??
    createWithdrawalService({
      prisma,
      balances: data,
      transfer: createTransferApi(env),
      vault,
      withdrawFeeBudgetLamports,
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
  const tokenStep = createTokenStep({
    ui,
    drafts: options.drafts ?? createTokenDraftService({ prisma }),
    data,
    ai,
    providers,
  });

  // Waits on 429 Too Many Requests, within bounds: updates are handled one at a time, so an
  // unlimited retry would stall every user, and would hang the startup instead of failing it.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 10 }));

  // The order is imposed by the ticket: nothing touches the database before privateOnly.
  bot.use(privateOnly);
  // Wraps everything below: a click always gets its one answer, whatever handled it.
  bot.use(ensureAnswered);
  bot.use(userActivity(prisma));
  bot.use(
    session({
      initial: initialSession,
      storage: createSessionStorage(prisma),
      getSessionKey: (ctx) => ctx.chat?.id.toString(),
    }),
  );
  // §9.4: a key or a seed phrase leaves the chat before anything else runs. It needs the
  // session (the input it answers) and it must run before the rate limit, which would drop the
  // update without deleting it, and before the gate, which would answer it with the Terms.
  bot.use(sensitiveMessageGuard(importConsumer(walletNav)));
  bot.use(globalRateLimit);
  // No conversation and no menu before the Terms and the channel (§4.2).
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
  registerHome(bot, router, access, { ui, env, data });
  registerWallets(router, inputs, walletNav);
  registerSimulationProvisional(router, ui, tokenStep);
  tokenStep.mount(router, inputs);
  // Until the ticket of a section registers its domain.
  registerComingSoon(router, ui);
  // The message that answers an input a screen waits for: a name, an address, an amount.
  bot.use(inputs.middleware());
  // Admin commands (V1-38) go here, after the gate: an admin accepts the Terms too.
  bot.use(router.middleware());

  bot.catch(handleBotError);
  return bot;
}

/**
 * The bot as a service of `runProcess`. The whole startup runs inside `start()`, in the order
 * of §12: configuration, devnet guard, database, Telegram, then polling. Any failure throws,
 * and `runProcess` logs it scrubbed and exits with code 1: no process runs half configured.
 */
export function createBotService(options: BotServiceOptions = {}): Service {
  let bot: Bot<BotContext> | undefined;

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

      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (error) {
        // A Prisma error can quote the connection string: only its code is kept.
        const code = (error as { code?: unknown }).code;
        throw new Error(
          `Refusing to start: cannot reach the database of DATABASE_URL (${String(code)}). Is PostgreSQL running (pnpm db:up)?`,
          { cause: error },
        );
      }

      bot = createBot(env, prisma);
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

      // `bot.start` deletes the webhook itself, then polls until `stop`: it is not awaited.
      void bot.start({
        allowed_updates: ["message", "edited_message", "callback_query"],
        onStart: (info) => log.info({ username: info.username }, "Long polling started"),
      });
    },
    // Finishes the update being handled before it resolves.
    stop: () => bot?.stop(),
  };
}
