import { resolveWithdrawAmount } from "@launchbot/db";
import type {
  AiQuotaStore,
  InvoiceCheck,
  InvoiceView,
  PayChoices,
  PayQuote,
  PrismaClient,
  TokenDraft,
  TokenDraftService,
  User,
  UserBalances,
  WalletBalance,
  WalletDetailData,
  WalletListData,
  WalletPaymentService,
  WalletService,
  WalletSummary,
  Withdrawal,
  WithdrawalService,
  WithdrawCheck,
} from "@launchbot/db";
import { AI_GENERATIONS_PER_DAY, computeMaxAmount, getOffer } from "@launchbot/shared";
import type { AiProviders } from "@launchbot/shared";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import type { Simulation, SimulationStore } from "@launchbot/db";
import type { TransferQuote } from "@launchbot/solana";
import type { Env, TelegramFile, TokenImageService } from "@launchbot/shared/server";
import { BotError, GrammyError } from "grammy";
import type { Bot } from "grammy";
import type { ApiResponse, ChatMember, InlineKeyboardMarkup, Update } from "grammy/types";
import type { BotContext, SessionData } from "./context.js";
import type { AdminServices } from "./features/admin/admin.js";
import type { InvoicePayments } from "./features/subscribe/invoice.js";
import { createBot } from "./index.js";
import type { Scheduler, SimRender, SimRunnerDeps } from "./services/sim-runner.js";
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

/** A virtual clock (V1-26): timers fire in order when the test advances the time. */
export function fakeScheduler() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const scheduler: Scheduler = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as number);
    },
  };
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return {
    scheduler,
    /** Runs every timer due until `ms` from now, letting the promises settle in between. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        const [id, timer] = due;
        timers.delete(id);
        now = Math.max(now, timer.at);
        timer.fn();
      }
      now = target;
      await flush();
    },
    pending: () => timers.size,
  };
}

/** A renderer that never touches resvg: a few bytes instead of a picture. */
export const fakeRender: SimRender = {
  chart: (frame) => Promise.resolve(new TextEncoder().encode(`chart@${frame.clock.nowSec}`)),
  card: (card) => Promise.resolve(new TextEncoder().encode(`card:${card.pnlPctText}`)),
  logo: (image) => Promise.resolve({ href: `data:${image.type};base64,fake` }),
};

/** The buttons of a keyboard as their texts, row by row. */
export const buttonTexts = (keyboard: InlineKeyboardMarkup): string[][] =>
  keyboard.inline_keyboard.map((row) => row.map((button) => button.text));

/** A 1 × 1 PNG: the logo of the drafts of the tests. */
const PNG_PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** Token images by `file_id` (V1-26): `file-1` is a PNG, anything else fails like Telegram. */
export function fakeImages(
  files: Record<string, TelegramFile> = {
    "file-1": { bytes: PNG_PIXEL, contentType: "image/png" },
  },
) {
  const requested: string[] = [];
  const service: TokenImageService = {
    get: (fileId) => {
      requested.push(fileId);
      const file = files[fileId];
      return file === undefined
        ? Promise.reject(new Error(`No file ${fileId}`))
        : Promise.resolve(file);
    },
  };
  return { ...service, requested };
}

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
  // The photo message of a simulation (V1-26): sent once, then its media is edited.
  if (method === "sendPhoto" || method === "editMessageMedia") {
    return {
      message_id: method === "sendPhoto" ? takeMessageId() : payload["message_id"],
      date: 0,
      chat: { id: payload["chat_id"], type: "private" },
      photo: [],
      caption: payload["caption"],
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

/** A text message; a command's entity covers the command, not its arguments, as Telegram does. */
export const textUpdate = (text: string, overrides: MessageOverrides = {}): Update =>
  messageUpdate(
    {
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]?.length }] }
        : {}),
    },
    overrides,
  );

/** A photo, the way Telegram sends one: no `text`, and a `caption` when the user wrote one. */
export const photoUpdate = (caption?: string): Update =>
  messageUpdate({ photo: [], ...(caption === undefined ? {} : { caption }) });

/** A click on a button of a screen, or of a picture (`photo`, the simulation of V1-26). */
export const callbackUpdate = (
  data: string,
  overrides: { chat?: Record<string, unknown>; messageId?: number; photo?: boolean } = {},
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
      ...(overrides.photo === true ? { photo: [] } : { text: "previous screen" }),
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
  SUPPORT_URL: "https://t.me/launchbot_support",
  // Nobody is an admin unless a test says so (`env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID] }`).
  ADMIN_TELEGRAM_IDS: [],
} as unknown as Env;

/** The Telegram id of the user of the tests, to make them an admin. */
export const ADMIN_ID = FROM.id;

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
    getCurveParams: () =>
      Promise.resolve({
        curve: FALLBACK_CURVE_PARAMS,
        source: "global",
        fetchedAt: BALANCES_READ_AT,
      }),
    getPlanStatus: () => Promise.resolve({ kind: "NONE" }),
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

/** The deposit address of the mockup of §8.3: a public example address, no key behind it. */
export const TEST_DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
/** A cuid of 25 characters, as the ids of `Payment` are: the callback data are measured on it. */
export const TEST_INVOICE_ID = "cmfq3v0n90000pay0invoice1";
/** $59 at $103.36 (§8.3): `0.5709 SOL` once rounded up. */
export const TEST_EXPECTED = 570_820_434n;
/** The end of the plan the fake activations give. */
export const TEST_PLAN_END = new Date("2026-09-26T12:05:00Z");

/** An invoice of V1-28: Premium 2 days of the user, pending, nothing received, 30:00 left. */
export const testInvoice = (overrides: Partial<InvoiceView> = {}): InvoiceView => ({
  id: TEST_INVOICE_ID,
  userId: TEST_USER.id,
  offer: getOffer("PREMIUM", "TWO_DAYS"),
  priceUsd: "59.00",
  solUsdRate: "103.36",
  expectedLamports: TEST_EXPECTED,
  receivedLamports: 0n,
  remainingLamports: TEST_EXPECTED,
  depositAddress: TEST_DEPOSIT,
  status: "PENDING",
  expiresAt: new Date("2026-09-24T12:35:00Z"),
  secondsLeft: 1_800,
  ...overrides,
});

/** The invoice once paid, as an activation reports it. */
export const activatedCheck = (checkedAt = new Date("2026-09-24T12:05:00Z")): InvoiceCheck => ({
  kind: "ACTIVATED",
  activatedNow: true,
  plan: "PREMIUM",
  expiresAt: TEST_PLAN_END,
  invoice: testInvoice({ status: "PAID", receivedLamports: TEST_EXPECTED, remainingLamports: 0n }),
  checkedAt,
});

/**
 * The invoices of V1-28 on the one pending invoice of the user (`TEST_INVOICE_ID`): any other
 * id, or another user, is not found; « I've paid » detects nothing; Cancel cancels.
 */
export function fakePayments(overrides: Partial<InvoicePayments> = {}): InvoicePayments {
  const mine = (paymentId: string, userId?: string) =>
    paymentId === TEST_INVOICE_ID && userId === TEST_USER.id;
  return {
    createInvoice: ({ offer }) =>
      Promise.resolve({ ok: true, invoice: testInvoice({ offer }), reused: false }),
    getInvoice: (paymentId, userId) =>
      Promise.resolve(mine(paymentId, userId) ? testInvoice() : null),
    checkInvoice: (paymentId, { now, userId }) =>
      Promise.resolve(
        mine(paymentId, userId)
          ? { kind: "NOT_DETECTED", invoice: testInvoice(), checkedAt: now }
          : { kind: "NOT_FOUND", checkedAt: now },
      ),
    cancelInvoice: (paymentId, userId) =>
      Promise.resolve(mine(paymentId, userId) ? "CANCELED" : "NOT_FOUND"),
    ...overrides,
  };
}

/**
 * Pay from my wallet (V1-31) on the fake balances: both wallets can pay the invoice, and every
 * Confirm shows its sending screen, then activates the plan.
 */
export function fakeWalletPayments(
  overrides: Partial<WalletPaymentService> = {},
): WalletPaymentService {
  const quoteOf = (wallet: WalletBalance): PayQuote => ({
    invoice: testInvoice(),
    feeLamports: TEST_FEE,
    wallet,
  });
  const choices = (): PayChoices => ({
    invoice: testInvoice(),
    feeLamports: TEST_FEE,
    wallets: TEST_BALANCES.wallets.map((wallet) => ({ wallet, missingLamports: 0n })),
  });
  return {
    listChoices: () => Promise.resolve({ status: "ok", ...choices() }),
    quote: (_userId, _paymentId, walletId) => {
      const wallet = findTestWallet(walletId);
      return Promise.resolve(
        wallet === undefined
          ? { status: "wallet_not_found", ...choices() }
          : { status: "ok", ...quoteOf(wallet) },
      );
    },
    pay: async (_userId, request, options = {}) => {
      const wallet = findTestWallet(request.walletId);
      if (wallet === undefined) return { status: "wallet_not_found", ...choices() };
      await options.onSending?.(quoteOf(wallet));
      return { status: "sent", check: activatedCheck() };
    },
    ...overrides,
  };
}

/** The data of the first button of the last screen edited: the Confirm of a flow (V1-14, V1-31). */
export const confirmData = (api: ReturnType<typeof interceptApi>): string => {
  const button = api.keyboard("editMessageText", -1)[0]?.[0];
  if (button === undefined || !("callback_data" in button)) throw new Error("no Confirm");
  return button.callback_data;
};

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

/** The Simulation table in memory (V1-22): rows in creation order, ids `s1`, `s2`… */
export function fakeSimulations(
  options: { now?: () => number; draftOf?: (draftId: string) => TokenDraft | undefined } = {},
) {
  const rows: Simulation[] = [];
  const now = options.now ?? Date.now;
  const draftOf = options.draftOf ?? (() => undefined);
  const store: SimulationStore = {
    findLatest: ({ userId, tokenDraftId, devBuySol, bundleSol }, since) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              row.userId === userId &&
              row.tokenDraftId === tokenDraftId &&
              Number(row.devBuySol) === devBuySol &&
              Number(row.bundleSol) === bundleSol &&
              row.createdAt > since,
          )
          .at(-1) ?? null,
      ),
    create: ({ userId, tokenDraftId, devBuySol, bundleSol, seed, params }) => {
      const row = {
        id: `s${rows.length + 1}`,
        userId,
        tokenDraftId,
        devBuySol: devBuySol.toString(),
        bundleSol: bundleSol.toString(),
        seed,
        params,
        createdAt: new Date(now()),
      } as unknown as Simulation;
      rows.push(row);
      return Promise.resolve(row);
    },
    findOwnedWithDraft: (userId, simId) => {
      const row = rows.find((candidate) => candidate.id === simId && candidate.userId === userId);
      const draft = row === undefined ? undefined : draftOf(row.tokenDraftId);
      if (row === undefined || draft === undefined) return Promise.resolve(null);
      const { name, symbol, description, imageFileId, website, twitter, telegram } = draft;
      return Promise.resolve({
        ...row,
        tokenDraft: { name, symbol, description, imageFileId, website, twitter, telegram },
      });
    },
  };
  return { ...store, rows };
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

/** Per service, only the methods a test replaces: the others keep their fake. */
export type AdminOverrides = { [K in keyof AdminServices]?: Partial<AdminServices[K]> };

/**
 * What the admin commands read and write (V1-42 to V1-44), on nothing: no account is found, no
 * grant is used, nothing is moved or deleted. A test replaces what its command reads.
 */
export function fakeAdmin(overrides: AdminOverrides = {}): AdminServices {
  const unexpected = () => Promise.reject(new Error("Not faked by this test"));
  return {
    subscriptions: {
      previewGrant: unexpected,
      confirmGrant: unexpected,
      isGrantUsed: () => Promise.resolve(false),
      ...overrides.subscriptions,
    },
    support: {
      findUser: () => Promise.resolve(null),
      findUserById: () => Promise.resolve(null),
      loadUserSupportData: unexpected,
      treasurySweeps: () => Promise.resolve([]),
      walletSecrets: () => Promise.resolve([]),
      ...overrides.support,
    },
    deletion: {
      getPurgeSummary: () => Promise.resolve(null),
      deleteUserData: () => Promise.resolve({ status: "NOT_FOUND" }),
      ...overrides.deletion,
    },
    sweeper: {
      sweepAccount: () => Promise.resolve({ status: "SWEPT", transfers: [] }),
      ...overrides.sweeper,
    },
    sensitive: { schedule: () => Promise.resolve(), ...overrides.sensitive },
  };
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
    payments?: Partial<InvoicePayments>;
    walletPayments?: Partial<WalletPaymentService>;
    drafts?: ReturnType<typeof fakeDrafts>;
    simulations?: ReturnType<typeof fakeSimulations>;
    aiQuota?: ReturnType<typeof fakeAiQuota>;
    /** No provider by default, as in V1: the local generator answers AI Generate. */
    aiProviders?: AiProviders;
    /** The virtual clock and the cap of the simulation runner (V1-26). */
    simRunner?: Partial<Pick<SimRunnerDeps, "scheduler" | "maxActive">>;
    images?: ReturnType<typeof fakeImages>;
    admin?: AdminOverrides;
  } = {},
) {
  const prisma = fakePrisma({ user: options.user });
  const data = fakeData(options.data);
  const wallets = fakeWallets(options.wallets);
  const withdrawals = fakeWithdrawals(options.withdrawals);
  const payments = fakePayments(options.payments);
  const walletPayments = fakeWalletPayments(options.walletPayments);
  const drafts = options.drafts ?? fakeDrafts();
  const simulations =
    options.simulations ?? fakeSimulations({ draftOf: (draftId) => drafts.rows.get(draftId) });
  const aiQuota = options.aiQuota ?? fakeAiQuota();
  const images = options.images ?? fakeImages();
  const admin = fakeAdmin(options.admin);
  const { bot, simRunner } = createBot({ ...TEST_ENV, ...options.env }, prisma, {
    data,
    wallets,
    withdrawals,
    payments,
    walletPayments,
    drafts,
    simulations,
    aiQuota,
    aiProviders: options.aiProviders ?? { text: null, logo: null },
    simRunner: { render: fakeRender, ...options.simRunner },
    images,
    admin,
  });
  return {
    bot,
    simRunner,
    images,
    admin,
    api: interceptApi(bot, options.replies),
    prisma,
    data,
    wallets,
    withdrawals,
    payments,
    walletPayments,
    drafts,
    simulations,
    aiQuota,
  };
}
