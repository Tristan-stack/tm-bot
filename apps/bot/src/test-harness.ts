import type { PrismaClient, User } from "@launchbot/db";
import type { Env } from "@launchbot/shared/server";
import { BotError, GrammyError } from "grammy";
import type { Bot } from "grammy";
import type { ApiResponse, Update } from "grammy/types";
import type { BotContext, SessionData } from "./context.js";

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

  return {
    calls,
    of: (method: string) => calls.filter((call) => call.method === method),
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
  return true;
}

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

export const TEST_USER: User = {
  id: "cjld2cjxh0000qzrmn831i7rn",
  telegramId: BigInt(FROM.id),
  username: FROM.username,
  firstName: FROM.first_name,
  termsVersion: null,
  termsAcceptedAt: null,
  channelCheckedAt: null,
  lastActiveAt: new Date("2026-09-20T14:32:00Z"),
  createdAt: new Date("2026-09-20T14:00:00Z"),
};

/** Only the calls the middlewares make: a session table and a user upsert. */
export function fakePrisma(sessions = new Map<string, string>()) {
  const upserts: { telegramId: bigint; lastActiveAt: Date }[] = [];
  const prisma = {
    sessions,
    upserts,
    user: {
      upsert: (args: { create: { telegramId: bigint }; update: { lastActiveAt: Date } }) => {
        upserts.push({
          telegramId: args.create.telegramId,
          lastActiveAt: args.update.lastActiveAt,
        });
        return Promise.resolve({ ...TEST_USER, lastActiveAt: args.update.lastActiveAt });
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
} as unknown as Env;
