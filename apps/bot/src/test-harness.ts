import type { PrismaClient, User } from "@launchbot/db";
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
    text: (method: string, index = 0) => String(of(method)[index]?.payload["text"]),
    keyboard: (method: string, index = 0) =>
      (of(method)[index]?.payload["reply_markup"] as InlineKeyboardMarkup).inline_keyboard,
  };
}

/** First id the fake gives to a sent message. */
export const FIRST_MESSAGE_ID = 100;

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

export const textUpdate = (
  text: string,
  overrides: { chat?: Record<string, unknown>; from?: Record<string, unknown> } = {},
): Update =>
  ({
    update_id: nextUpdateId++,
    message: {
      message_id: 10,
      date: 0,
      chat: { ...CHAT, ...overrides.chat },
      from: { ...FROM, ...overrides.from },
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] }
        : {}),
    },
  }) as unknown as Update;

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

/**
 * The data behind the home screen, without the RPC, the price provider or a database: the
 * user of §4.3, with two wallets and no subscription. `overrides` replaces any read.
 */
export function fakeData(overrides: Partial<DataServices> = {}): DataServices {
  const balances = {
    wallets: [
      { id: "w1", name: "Main", publicKey: "pk-main", lamports: 4_200_000_000n },
      { id: "w2", name: "Second", publicKey: "pk-second", lamports: 50_000_000n },
    ],
    totalLamports: 4_250_000_000n,
    fetchedAt: BALANCES_READ_AT,
    status: "fresh" as const,
  };
  return {
    getUserBalances: () => Promise.resolve(balances),
    invalidateUserBalances: () => undefined,
    getSolUsdPrice: () => Promise.resolve(103.36),
    getSolUsdQuote: () =>
      Promise.resolve({ price: 103.36, fetchedAt: BALANCES_READ_AT, isFallback: false }),
    getSubscriptionSummary: () => Promise.resolve({ active: null, lastExpired: null }),
    countActiveSubscribers: () => Promise.resolve(767),
    getBotChannelMemberCount: () => Promise.resolve(1248),
    ...overrides,
  };
}

/** The whole bot on fakes: no Telegram, no database, no RPC, no price provider. */
export function botHarness(
  options: {
    user?: Partial<User>;
    replies?: ApiReplies;
    env?: Partial<Env>;
    data?: Partial<DataServices>;
  } = {},
) {
  const prisma = fakePrisma({ user: options.user });
  const data = fakeData(options.data);
  const bot = createBot({ ...TEST_ENV, ...options.env }, prisma, { data });
  return { bot, api: interceptApi(bot, options.replies), prisma, data };
}
