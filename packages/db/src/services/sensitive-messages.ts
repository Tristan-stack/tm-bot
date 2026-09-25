import type { PrismaClient, SensitiveMessage } from "../generated/prisma/client.js";

/**
 * The messages of the bot that hold wallet keys (/getall, V1-43), deleted at `deleteAt` by the
 * sweeper of the bot. In the database, so a restart forgets none of them: nothing of the message
 * is kept, only where it is.
 */
export type SensitiveMessageStore = {
  /** Recorded right after the send: a crash in between is the risk left (V1-43). */
  schedule: (chatId: bigint, messageId: number, deleteAt: Date) => Promise<void>;
  /** The rows due at `now`, the oldest first. */
  listDue: (now: Date, limit: number) => Promise<SensitiveMessage[]>;
  /** Deleted from the chat, or never deletable: the row goes. */
  remove: (id: string) => Promise<void>;
  /** A failure that may pass (network, 5xx): tried again at the next pass. */
  retryLater: (id: string) => Promise<void>;
};

export function createSensitiveMessageStore(deps: { prisma: PrismaClient }): SensitiveMessageStore {
  const { prisma } = deps;
  return {
    async schedule(chatId, messageId, deleteAt) {
      await prisma.sensitiveMessage.upsert({
        where: { chatId_messageId: { chatId, messageId } },
        create: { chatId, messageId, deleteAt },
        update: { deleteAt },
      });
    },

    listDue: (now, limit) =>
      prisma.sensitiveMessage.findMany({
        where: { deleteAt: { lte: now } },
        orderBy: { deleteAt: "asc" },
        take: limit,
      }),

    async remove(id) {
      await prisma.sensitiveMessage.deleteMany({ where: { id } });
    },

    async retryLater(id) {
      await prisma.sensitiveMessage.updateMany({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
    },
  };
}
