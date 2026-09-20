import type { PrismaClient, User } from "../generated/prisma/client.js";

export type TelegramIdentity = {
  /** `ctx.from.id`: a number below 2^53, stored as a BigInt. */
  telegramId: number;
  username?: string;
  firstName?: string;
};

/**
 * Creates the account on first contact and records the activity on every message and every
 * click: an account with no activity for 48 h is deleted without warning, after its funds are
 * swept to the treasury (decision of 16/09/2026, V1-45).
 */
export function touchUser(
  prisma: PrismaClient,
  identity: TelegramIdentity,
  now: Date = new Date(),
): Promise<User> {
  const username = identity.username ?? null;
  const firstName = identity.firstName ?? null;
  return prisma.user.upsert({
    where: { telegramId: BigInt(identity.telegramId) },
    create: { telegramId: BigInt(identity.telegramId), username, firstName, lastActiveAt: now },
    update: { username, firstName, lastActiveAt: now },
  });
}
