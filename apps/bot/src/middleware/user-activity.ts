import { touchUser } from "@launchbot/db";
import type { PrismaClient } from "@launchbot/db";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";

/**
 * Creates the account on first contact and records `lastActiveAt` on every message and every
 * click (§11.3): an account inactive for 48 h is deleted without warning (V1-45).
 */
export const userActivity =
  (prisma: PrismaClient): MiddlewareFn<BotContext> =>
  async (ctx, next) => {
    const from = ctx.from;
    if (from === undefined) return;
    ctx.user = await touchUser(prisma, {
      telegramId: from.id,
      username: from.username,
      firstName: from.first_name,
    });
    await next();
  };
