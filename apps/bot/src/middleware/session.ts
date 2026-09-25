import { PrismaAdapter } from "@grammyjs/storage-prisma";
import type { PrismaClient } from "@launchbot/db";
import { createLogger } from "@launchbot/shared/server";
import type { Context, StorageAdapter } from "grammy";
import { isSessionData } from "../context.js";
import type { BotContext, SessionData } from "../context.js";

const log = createLogger("bot:session");

/**
 * Sessions and conversations share the `Session` table: the conversations get this prefix. In
 * @launchbot/db, which deletes both rows of a user with the account (V1-44).
 */
export { CONVERSATION_KEY_PREFIX } from "@launchbot/db";

/** One session per private chat (D16). */
export const sessionKeyOf = (ctx: Context): string | undefined => ctx.chat?.id.toString();

/**
 * Writes the session of the update now, not at its end: what must survive the process stopping
 * in the middle of the update (the posts of an /announce, V1-38). The end of the update writes
 * it again, as usual.
 */
export async function saveSessionNow(
  storage: StorageAdapter<SessionData>,
  ctx: BotContext,
): Promise<void> {
  const key = sessionKeyOf(ctx);
  if (key !== undefined) await storage.write(key, ctx.session);
}

/**
 * Sessions survive a deployment: data this version cannot read (corrupt JSON, unknown `v`) is
 * dropped and rebuilt from `initialSession`, instead of failing every update of that chat.
 */
export function createSessionStorage(prisma: PrismaClient): StorageAdapter<SessionData> {
  const adapter = new PrismaAdapter<SessionData>(prisma.session);
  // grammY writes the session back after every update that read it. With one screen message
  // per chat it almost never changes: the JSON seen at read time lets the write be skipped.
  const asRead = new WeakMap<SessionData, string>();

  return {
    async read(key) {
      let stored: unknown;
      try {
        stored = await adapter.read(key);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        // Corrupt JSON: handled below like any other row this version cannot read.
        stored = null;
      }
      if (stored === undefined) return undefined;
      if (!isSessionData(stored)) {
        log.warn({ key }, "Unreadable session dropped");
        return undefined;
      }
      asRead.set(stored, JSON.stringify(stored));
      return stored;
    },
    async write(key, value) {
      if (asRead.get(value) === JSON.stringify(value)) return;
      await adapter.write(key, value);
    },
    delete: (key) => adapter.delete(key),
  };
}
