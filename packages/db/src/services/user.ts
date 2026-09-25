import type { Db } from "../client.js";
import type { PrismaClient, User } from "../generated/prisma/client.js";

/** Sessions and conversations share the `Session` table (V1-04): the conversations get this prefix. */
export const CONVERSATION_KEY_PREFIX = "conversation-";

/**
 * The rows of `Session` of a user: grammY keys a session by the chat, and the chat of a private
 * conversation has the id of the user (V1-04). A purge deletes them with the account (V1-44).
 */
export const sessionKeysOf = (telegramId: bigint): string[] => [
  telegramId.toString(),
  `${CONVERSATION_KEY_PREFIX}${telegramId.toString()}`,
];

/** The account of a Telegram id: what the admin commands look up (V1-40). */
export const findUserByTelegramId = (prisma: Db, telegramId: bigint): Promise<User | null> =>
  prisma.user.findUnique({ where: { telegramId } });

export type LockedUser = Pick<User, "telegramId" | "lastActiveAt">;

/**
 * Locks the row of a user until the transaction ends (`SELECT … FOR UPDATE`): the activations of
 * a plan (V1-27), a /grant (V1-42) and the deletion of the account (V1-44) wait for each other.
 * `undefined` when the account does not exist.
 */
export async function lockUserRow(tx: Db, userId: string): Promise<LockedUser | undefined> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "telegramId", "lastActiveAt" FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return rows[0];
}

export type TelegramIdentity = {
  /** `ctx.from.id`: a number below 2^53, stored as a BigInt. */
  telegramId: number;
  username?: string;
  firstName?: string;
};

/**
 * Creates the account on first contact and records the activity on every message and every
 * click: an account with no activity for 24 h is deleted without warning, after its funds are
 * swept to the treasury (decision of 16/09/2026, 24 h since 25/09/2026, V1-45).
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
