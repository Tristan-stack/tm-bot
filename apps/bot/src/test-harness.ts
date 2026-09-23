import { resolveWithdrawAmount } from "@launchbot/db";
import type {
  AiQuotaStore,
  PrismaClient,
  TokenDraft,
  TokenDraftService,
  User,
  UserBalances,
  WalletBalance,
  WalletDetailData,
  WalletListData,
  WalletService,
  WalletSummary,
  Withdrawal,
  WithdrawalService,
  WithdrawCheck,
} from "@launchbot/db";
import { AI_GENERATIONS_PER_DAY, computeMaxAmount } from "@launchbot/shared";
import type { AiProviders } from "@launchbot/shared";
import type { TransferQuote } from "@launchbot/solana";
import type { Env } from "@launchbot/shared/server";
import { BotError, GrammyError } from "grammy";
import type { Bot } from "grammy";
import type { ApiResponse, ChatMember, InlineKeyboardMarkup, Update } from "grammy/types";
import type { BotContext, SessionData } from "./context.js";
import { createBot } from "./index.js";
import type { DataServices } from "./services/data.js";

/** Every Telegram call a test made, in order. Never asserted against a real API. */
export type ApiCall = { method: string; payload: Record<string, unknown> };

/** Replies the fake transport gives, by method. A GrammyError makes the call fail. */
export type ApiReplies = Partial<Record<string, unknown>>;

const BOT_INFO = {
  id: 424242,
  is_bot: true as const,
  first_name: "Launch Bot",
  username: "launchbot_test",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business_account: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

/**
 * Replaces the Telegram transport: nothing leaves the process, and a test can make any method
 * fail with a real GrammyError to exercise the fallbacks of `showScreen`.
 */
export function interceptApi(bot: Bot<BotContext>, replies: ApiReplies = {}) {
  const calls: ApiCall[] = [];
  let nextMessageId = FIRST_MESSAGE_ID;
  bot.botInfo = BOT_INFO;

  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    const reply = replies[method];
    if (reply instanceof GrammyError) return Promise.reject(reply);
    const result = reply ?? defaultResult(method, payload, () => nextMessageId++);
    return Promise.resolve({ ok: true, result } as ApiResponse<never>);
  });

  const of = (method: string) => calls.filter((call) => call.method === method);
  return {
    calls,
    of,
    /** The text of the nth call of a method: a screen, or the answer to a click. */
    /** The text of the nth call of a method (`-1`: the last one): a screen, or a toast. */
    text: (method: string, index = 0) => String(of(method).at(index)?.payload["text"]),
    keyboard: (method: string, index = 0) =>
      (of(method).at(index)?.payload["reply_markup"] as InlineKeyboardMarkup).inline_keyboard,
    /** The last screen edited in place: what a click, or an input answered in place, shows. */
    screen: () => String(of("editMessageText").at(-1)?.payload["text"]),
    /** The last answer to a click: its `text` and `show_alert`, or nothing for a bare answer. */
    lastAlert: () => of("answerCallbackQuery").at(-1)?.payload,
  };
}

/** First id the fake gives to a sent message. */
export const FIRST_MESSAGE_ID = 100;

/** The keyboard of a screen a builder returned, for the tests that assert on its buttons. */
export const keyboardOf = (screen: {
  reply_markup: { inline_keyboard: unknown[][] };
}): unknown[][] => screen.reply_markup.inline_keyboard;

function defaultResult(
  method: string,
  payload: Record<string, unknown>,
  takeMessageId: () => number,
): unknown {
  if (method === "sendMessage" || method === "editMessageText") {
    return {
      message_id: method === "sendMessage" ? takeMessageId() : payload["message_id"],
      date: 0,
      chat: { id: payload["chat_id"], type: "private" },
      text: payload["text"],
    };
  }
  // By default the user is in every channel, and the bot administers them.
  if (method === "getChatMember") return chatMember("member");
  return true;
}

/** A `getChatMember` result. `extra` holds what a status adds (`is_member`, admin rights). */
export const chatMember = (status: string, extra: Record<string, unknown> = {}) =>
  ({ status, user: FROM, ...extra }) as unknown as ChatMember;

/**
 * Feeds one update the way long polling does: `handleUpdate` rethrows a failure, and the
 * polling loop hands it to the handler registered with `bot.catch`.
 */
export async function feed(bot: Bot<BotContext>, update: Update): Promise<void> {
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    if (!(error instanceof BotError)) throw error;
    // `instanceof` cannot recover the context type: this bot only ever builds BotContext.
    await bot.errorHandler(error as BotError<BotContext>);
  }
}

/** A 400 from Telegram, built the way grammY builds it. */
export const telegramError = (method: string, description: string): GrammyError =>
  new GrammyError(
    `Call to '${method}' failed!`,
    { ok: false, error_code: 400, description },
    method,
    {},
  );

const CHAT = { id: 777, type: "private" as const, first_name: "Tristan" };
const FROM = { id: 123456789, is_bot: false, first_name: "Tristan", username: "tristan" };

let nextUpdateId = 1;

type MessageOverrides = { chat?: Record<string, unknown>; from?: Record<string, unknown> };

const privateMessage = (fields: Record<string, unknown>, overrides: MessageOverrides = {}) => ({
  message_id: 10,
  date: 0,
  chat: { ...CHAT, ...overrides.chat },
  from: { ...FROM, ...overrides.from },
  ...fields,
});

/** A message of the user in the private chat, with the fields of its kind (`text`, `photo`…). */
export const messageUpdate = (
  fields: Record<string, unknown>,
  overrides: MessageOverrides = {},
): Update => ({
  update_id: nextUpdateId++,
  message: privateMessage(fields, overrides),
});

/** The same message, edited by the user: the guard of V1-12 watches these too. */
export const editedTextUpdate = (text: string): Update => ({
  update_id: nextUpdateId++,
  // `edited_message` carries `edit_date`, which the shape of the fields cannot express.
  edited_message: privateMessage({ text, edit_date: 1 }) as NonNullable<Update["edited_message"]>,
});

export const textUpdate = (text: string, overrides: MessageOverrides = {}): Update =>
  messageUpdate(
    {
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] }
        : {}),
    },
    overrides,
  );

/** A photo, the way Telegram sends one: no `text`, and a `caption` when the user wrote one. */
export const photoUpdate = (caption?: string): Update =>
  messageUpdate({ photo: [], ...(caption === undefined ? {} : { caption }) });

export const callbackUpdate = (
  data: string,
  overrides: { chat?: Record<string, unknown>; messageId?: number } = {},
): Update => ({
  update_id: nextUpdateId++,
  callback_query: {
    id: `cb-${nextUpdateId}`,
    from: FROM,
    chat_instance: "1",
    data,
    message: {
      message_id: overrides.messageId ?? 50,
      date: 0,
      chat: { ...CHAT, ...overrides.chat },
      from: BOT_INFO,
      text: "previous screen",
    },
  },
});

export const channelPost = (): Update =>
  ({
    update_id: nextUpdateId++,
    channel_post: {
      message_id: 11,
      date: 0,
      chat: { id: -1001234567890, type: "channel", title: "Launch Bot" },
      text: "/start",
    },
  }) as unknown as Update;

/** A user who is through the first access: current Terms accepted, channel joined. */
export const TEST_USER: User = {
  id: "cjld2cjxh0000qzrmn831i7rn",
  telegramId: BigInt(FROM.id),
  username: FROM.username,
  firstName: FROM.first_name,
  termsVersion: 1,
  termsAcceptedAt: new Date("2026-09-20T14:01:00Z"),
  channelCheckedAt: new Date("2026-09-20T14:02:00Z"),
  lastActiveAt: new Date("2026-09-20T14:32:00Z"),
  createdAt: new Date("2026-09-20T14:00:00Z"),
};

/** Someone who has never used the bot: no Terms accepted, channel never checked. */
export const NEW_USER = { termsVersion: null, termsAcceptedAt: null, channelCheckedAt: null };

/**
 * Only the calls the bot makes: a session table and one user row, which `update` changes so
 * the next update of a test sees it. By default the channel was checked just now, so a /start
 * is served from the cache of the membership.
 */
export function fakePrisma(options: { sessions?: Map<string, string>; user?: Partial<User> } = {}) {
  const { sessions = new Map<string, string>() } = options;
  const upserts: { telegramId: bigint; lastActiveAt: Date }[] = [];
  const updates: Partial<User>[] = [];
  let user: User = { ...TEST_USER, channelCheckedAt: new Date(), ...options.user };
  const prisma = {
    sessions,
    upserts,
    updates,
    currentUser: () => user,
    user: {
      update: ({ data }: { data: Partial<User> }) => {
        updates.push(data);
        user = { ...user, ...data };
        return Promise.resolve(user);
      },
      upsert: (args: { create: { telegramId: bigint }; update: { lastActiveAt: Date } }) => {
        upserts.push({
          telegramId: args.create.telegramId,
          lastActiveAt: args.update.lastActiveAt,
        });
        user = { ...user, lastActiveAt: args.update.lastActiveAt };
        return Promise.resolve(user);
      },
    },
    session: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(
          sessions.has(where.key) ? { key: where.key, value: sessions.get(where.key) } : null,
        ),
      upsert: ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        sessions.set(where.key, create.value);
        return Promise.resolve({ key: where.key, value: create.value });
      },
      delete: ({ where }: { where: { key: string } }) => {
        sessions.delete(where.key);
        return Promise.resolve({ key: where.key, value: "" });
      },
    },
    $queryRaw: () => Promise.resolve([{ "?column?": 1 }]),
  };
  return prisma as unknown as PrismaClient & typeof prisma;
}

export const storedSession = (
  prisma: ReturnType<typeof fakePrisma>,
  key = String(CHAT.id),
): SessionData | undefined => {
  const raw = prisma.sessions.get(key);
  return raw === undefined ? undefined : (JSON.parse(raw) as SessionData);
};

export const TEST_ENV = {
  BOT_TOKEN: `123456789:${"AbC-dEf_9".repeat(4)}`,
  SOLANA_CLUSTER: "devnet",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  // Required by Env; never used, since every test injects its wallet service.
  WALLET_ENCRYPTION_KEY: new Uint8Array(32),
  PRIORITY_FEE_MAX_MICROLAMPORTS: 1_000_000,
  TERMS_VERSION: 1,
  WEBAPP_URL: "https://launchbot.example.com",
  CHANNEL_BOT_ID: "-1001000000001",
  CHANNEL_BOT_URL: "https://t.me/launchbot_channel",
  CHANNEL_SUCCESS_ID: "-1001000000002",
  CHANNEL_SUCCESS_URL: "https://t.me/launchbot_success",
  CHANNEL_ANNOUNCEMENTS_ID: "-1001000000003",
  CHANNEL_ANNOUNCEMENTS_URL: "https://t.me/launchbot_news",
} as unknown as Env;

/** When the fake balances were read: the home screen shows it as "Updated 14:32 UTC". */
export const BALANCES_READ_AT = new Date("2026-09-21T14:32:00Z");

/** The two wallets of the mockups (§4.3, §9.1), the way the balance service returns them. */
export const MAIN_WALLET: WalletBalance = {
  id: "w1",
  name: "Main",
  publicKey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  createdAt: new Date("2026-09-12T09:00:00Z"),
  lamports: 2_500_000_000n,
};
export const TEST_WALLET: WalletBalance = {
  id: "w2",
  name: "Test",
  publicKey: "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81",
  createdAt: new Date("2026-09-15T09:00:00Z"),
  lamports: 1_750_000_000n,
};

export const TEST_BALANCES: UserBalances = {
  wallets: [MAIN_WALLET, TEST_WALLET],
  totalLamports: 4_250_000_000n,
  fetchedAt: BALANCES_READ_AT,
  status: "fresh",
};

/** A wallet of the fake balances, by id. */
const findTestWallet = (walletId: string) =>
  TEST_BALANCES.wallets.find((candidate) => candidate.id === walletId);
const detailOf = (wallet: WalletBalance): WalletDetailData => ({
  wallet,
  fetchedAt: TEST_BALANCES.fetchedAt,
  status: TEST_BALANCES.status,
});

/** The wallet service on the fake balances: no key, no vault, no database. */
export function fakeWallets(overrides: Partial<WalletService> = {}): WalletService {
  const list: WalletListData = { ...TEST_BALANCES, count: 2, limit: 3 };
  const created: WalletSummary = {
    id: "w3",
    name: "Wallet 3",
    publicKey: "9yKq3Vn8dSmyqWbTt7YdUBw3FvJ1AsTnFbxJ6t4AjkHo",
    createdAt: new Date("2026-09-21T14:40:00Z"),
  };
  const find = findTestWallet;
  return {
    listWithBalances: () => Promise.resolve(list),
    getOwned: (_userId, walletId) => {
      const wallet = find(walletId);
      return Promise.resolve(wallet === undefined ? null : detailOf(wallet));
    },
    getQuota: () => Promise.resolve({ count: list.count, limit: list.limit, reached: false }),
    nextDefaultName: () => Promise.resolve(created.name),
    create: () => Promise.resolve({ ok: true, wallet: created }),
    // The parsers and the vault are tested in their own packages: here every secret imports.
    importWallet: () => Promise.resolve({ ok: true, wallet: created }),
    rename: (_userId, walletId, rawName) => {
      const wallet = find(walletId);
      return Promise.resolve(
        wallet === undefined
          ? { ok: false, issue: { reason: "not_found" } }
          : { ok: true, wallet: { ...wallet, name: rawName.trim() } },
      );
    },
    // By id, not by balance: the first wallet is blocked, the second one can be deleted.
    checkDeletable: (_userId, walletId) => {
      const wallet = find(walletId);
      if (wallet === undefined) return Promise.resolve({ status: "not_found" });
      const detail = detailOf(wallet);
      return Promise.resolve(
        wallet.id === "w1"
          ? { status: "blocked_balance", detail, lamports: wallet.lamports ?? 0n }
          : { status: "confirm", detail },
      );
    },
    delete: (_userId, walletId) =>
      Promise.resolve(walletId === "w2" ? { status: "deleted" } : { status: "not_found" }),
    ...overrides,
  };
}

/**
 * The data behind the home screen, without the RPC, the price provider or a database: the
 * user of §4.3, with two wallets and no subscription. `overrides` replaces any read.
 */
export function fakeData(overrides: Partial<DataServices> = {}): DataServices {
  const balances = TEST_BALANCES;
  return {
    getUserBalances: () => Promise.resolve(balances),
    invalidateUserBalances: () => undefined,
    getSolUsdPrice: () => Promise.resolve(103.36),
    getSolUsdQuote: () =>
      Promise.resolve({ price: 103.36, fetchedAt: BALANCES_READ_AT, isFallback: false }),
    getSubscriptionSummary: () => Promise.resolve({ active: null, lastExpired: null }),
    hasActivePremium: () => Promise.resolve(false),
    countActiveSubscribers: () => Promise.resolve(767),
    getBotChannelMemberCount: () => Promise.resolve(1248),
    ...overrides,
  };
}

/** `getMinimumBalanceForRentExemption(0)` on devnet, as the fake withdrawals answer it. */
export const TEST_RENT_MIN = 890_880n;
/** The fee of a transfer in the fakes: the base fee, no priority fee, as devnet mostly is. */
export const TEST_FEE = 5_000n;
/**
 * The signature of the mockup of §9.5 (`5KtP…x9Qm`), as the fake send answers it. Built at
 * runtime: 88 base58 characters in a source file look like a secret key to a scanner.
 */
export const TEST_SIGNATURE = `5KtP${"1".repeat(80)}x9Qm`;

/** A quote of V1-13 as the fakes make it: 1.250 SOL from Main to Test unless told otherwise. */
export const testQuote = (overrides: Partial<TransferQuote> = {}): TransferQuote => ({
  from: MAIN_WALLET.publicKey,
  to: TEST_WALLET.publicKey,
  mode: "exact",
  amountLamports: 1_250_000_000n,
  balanceLamports: MAIN_WALLET.lamports ?? 0n,
  destinationLamports: TEST_RENT_MIN,
  rentMinLamports: TEST_RENT_MIN,
  fee: {
    microLamportsPerCu: 0n,
    computeUnitLimit: 540,
    baseFeeLamports: TEST_FEE,
    priorityFeeLamports: 0n,
    totalFeeLamports: TEST_FEE,
  },
  ...overrides,
});

/** The row of a withdrawal the fake service records, CONFIRMED unless told otherwise. */
export const testWithdrawal = (overrides: Partial<Withdrawal> = {}): Withdrawal => ({
  id: "wd1",
  userId: TEST_USER.id,
  walletId: MAIN_WALLET.id,
  fromAddress: MAIN_WALLET.publicKey,
  toAddress: TEST_WALLET.publicKey,
  lamports: 1_250_000_000n,
  feeLamports: TEST_FEE,
  signature: TEST_SIGNATURE,
  status: "CONFIRMED",
  error: null,
  kind: "USER",
  userTelegramId: null,
  createdAt: new Date("2026-09-23T14:35:00Z"),
  ...overrides,
});

/**
 * The withdrawal service on the fake balances: every wallet can withdraw, every quote is
 * accepted as V1-13 would price it, every send confirms, and nothing is ever in flight.
 */
export function fakeWithdrawals(overrides: Partial<WithdrawalService> = {}): WithdrawalService {
  const check = (walletId: string): WithdrawCheck => {
    const wallet = findTestWallet(walletId);
    if (wallet === undefined) return { status: "not_found" };
    const lamports = wallet.lamports ?? 0n;
    return {
      status: "ok",
      detail: detailOf(wallet),
      lamports,
      feeLamports: TEST_FEE,
      maxLamports: computeMaxAmount(lamports, TEST_FEE),
      rentMinLamports: TEST_RENT_MIN,
    };
  };
  return {
    check: (_userId, walletId) => Promise.resolve(check(walletId)),
    quote: (_userId, walletId, to, amount) => {
      const checked = check(walletId);
      if (checked.status !== "ok") return Promise.resolve(checked);
      const lamports = resolveWithdrawAmount(checked.lamports, amount);
      const quote = testQuote({
        from: checked.detail.wallet.publicKey,
        to,
        mode: lamports === "max" ? "max" : "exact",
        amountLamports: lamports === "max" ? checked.maxLamports : lamports,
        balanceLamports: checked.lamports,
      });
      return Promise.resolve({ status: "ok", check: checked, quote });
    },
    execute: (_userId, walletId, to, amount) => {
      const wallet = findTestWallet(walletId);
      if (wallet === undefined) return Promise.resolve({ status: "not_found" });
      const lamports =
        amount.kind === "max" ? computeMaxAmount(wallet.lamports ?? 0n, TEST_FEE) : amount.lamports;
      const withdrawal = testWithdrawal({
        walletId,
        fromAddress: wallet.publicKey,
        toAddress: to,
        lamports,
      });
      return Promise.resolve({ status: "sent", withdrawal });
    },
    resolve: () => Promise.resolve(null),
    ...overrides,
  };
}

/** A row of `TokenDraft` (§13), empty unless told otherwise. */
export const testDraft = (overrides: Partial<TokenDraft> = {}): TokenDraft => ({
  id: "d1",
  userId: TEST_USER.id,
  name: null,
  symbol: null,
  description: null,
  imageFileId: null,
  website: null,
  twitter: null,
  telegram: null,
  createdAt: new Date("2026-09-23T14:00:00Z"),
  updatedAt: new Date("2026-09-23T14:00:00Z"),
  ...overrides,
});

/**
 * The draft service in memory: the rows, and the ids a Simulation references, so the copy on
 * write of V1-16 is exercised. The service itself is tested in @launchbot/db.
 */
export function fakeDrafts(options: { rows?: TokenDraft[]; referenced?: string[] } = {}) {
  const rows = new Map((options.rows ?? []).map((row) => [row.id, row]));
  const referenced = new Set(options.referenced ?? []);
  let nextId = rows.size + 1;
  const owned = (userId: string, id: string) => {
    const row = rows.get(id);
    return row?.userId === userId ? row : null;
  };
  const service: TokenDraftService = {
    getOwnedDraft: (userId, id) => Promise.resolve(owned(userId, id)),
    write: (userId, id, patch) => {
      const current = id === null ? null : owned(userId, id);
      const base = current === null || referenced.has(current.id) ? null : current;
      const row =
        base === null
          ? testDraft({ ...(current ?? {}), ...patch, id: `d${nextId++}`, userId })
          : { ...base, ...patch };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
  };
  return { ...service, rows, referenced };
}

/**
 * The AI quota in memory (V1-17): TEXT generations of today per user, and the LOGO rows. The
 * UTC window and the lock are tested on the real store in @launchbot/db.
 */
export function fakeAiQuota(options: { used?: number } = {}) {
  const used = new Map<string, number>();
  if (options.used !== undefined) used.set(TEST_USER.id, options.used);
  const logos: string[] = [];
  const store: AiQuotaStore = {
    limit: AI_GENERATIONS_PER_DAY,
    countText: (userId) => Promise.resolve(used.get(userId) ?? 0),
    reserveText: (userId) => {
      const count = used.get(userId) ?? 0;
      if (count >= AI_GENERATIONS_PER_DAY) return Promise.resolve({ ok: false, used: count });
      used.set(userId, count + 1);
      return Promise.resolve({ ok: true, used: count + 1 });
    },
    recordLogo: (userId) => {
      logos.push(userId);
      return Promise.resolve();
    },
  };
  return { ...store, used, logos };
}

/** The whole bot on fakes: no Telegram, no database, no RPC, no price provider. */
export function botHarness(
  options: {
    user?: Partial<User>;
    replies?: ApiReplies;
    env?: Partial<Env>;
    data?: Partial<DataServices>;
    wallets?: Partial<WalletService>;
    withdrawals?: Partial<WithdrawalService>;
    drafts?: ReturnType<typeof fakeDrafts>;
    aiQuota?: ReturnType<typeof fakeAiQuota>;
    /** No provider by default, as in V1: the local generator answers AI Generate. */
    aiProviders?: AiProviders;
  } = {},
) {
  const prisma = fakePrisma({ user: options.user });
  const data = fakeData(options.data);
  const wallets = fakeWallets(options.wallets);
  const withdrawals = fakeWithdrawals(options.withdrawals);
  const drafts = options.drafts ?? fakeDrafts();
  const aiQuota = options.aiQuota ?? fakeAiQuota();
  const bot = createBot({ ...TEST_ENV, ...options.env }, prisma, {
    data,
    wallets,
    withdrawals,
    drafts,
    aiQuota,
    aiProviders: options.aiProviders ?? { text: null, logo: null },
  });
  return {
    bot,
    api: interceptApi(bot, options.replies),
    prisma,
    data,
    wallets,
    withdrawals,
    drafts,
    aiQuota,
  };
}
