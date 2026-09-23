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

/**
 * A request of the Mini App is an activity too (§11.3, V1-23): `lastActiveAt` of the account
 * of this Telegram id, when it exists. Never creates an account: `true` when one was touched.
 */
export async function touchUserActivity(
  prisma: PrismaClient,
  telegramId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: { telegramId: BigInt(telegramId) },
    data: { lastActiveAt: now },
  });
  return count > 0;
}

/** Records the version of the Terms the user accepted, and when (§4.2, §11.2). */
export function acceptTerms(
  prisma: PrismaClient,
  userId: string,
  version: number,
  now: Date = new Date(),
): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { termsVersion: version, termsAcceptedAt: now },
  });
}

/**
 * `channelCheckedAt` is the date of the last check that found the user in the channel of the
 * bot: `null` after a check that did not (§4.2).
 */
export function setChannelCheckedAt(
  prisma: PrismaClient,
  userId: string,
  at: Date | null,
): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { channelCheckedAt: at } });
}
