import type { PrismaClient, TokenDraft } from "../generated/prisma/client.js";

export type { TokenDraft } from "../generated/prisma/client.js";

/** The columns the Token screen writes (§5, §13). `symbol` is stored without its `$`. */
export type TokenDraftFields = Pick<
  TokenDraft,
  "name" | "symbol" | "description" | "imageFileId" | "website" | "twitter" | "telegram"
>;
export type TokenDraftPatch = Partial<TokenDraftFields>;

export type TokenDraftsDeps = { prisma: PrismaClient };

export type TokenDraftService = {
  /** `null` for an id that is not a draft of this user: a purged one, or someone else's. */
  getOwnedDraft: (userId: string, draftId: string) => Promise<TokenDraft | null>;
  /**
   * Writes the patch and returns the draft it landed in, whose id the caller keeps:
   * - no draft yet, or an id that is not theirs: a new row (created lazily, V1-16);
   * - a draft a Simulation references: a modified copy, the original is never touched (D14);
   * - otherwise the row itself.
   */
  write: (userId: string, draftId: string | null, patch: TokenDraftPatch) => Promise<TokenDraft>;
};

export function createTokenDraftService({ prisma }: TokenDraftsDeps): TokenDraftService {
  const getOwnedDraft = (userId: string, draftId: string) =>
    prisma.tokenDraft.findFirst({ where: { id: draftId, userId } });

  async function write(userId: string, draftId: string | null, patch: TokenDraftPatch) {
    const current =
      draftId === null
        ? null
        : await prisma.tokenDraft.findFirst({
            where: { id: draftId, userId },
            include: { _count: { select: { simulations: true } } },
          });
    if (current === null) return prisma.tokenDraft.create({ data: { userId, ...patch } });
    // Copy on write (proposal): a simulation must show the token it was created with.
    const { _count, ...row } = current;
    if (_count.simulations > 0) {
      const copy: Partial<TokenDraft> = { ...row };
      delete copy.id;
      delete copy.createdAt;
      delete copy.updatedAt;
      return prisma.tokenDraft.create({ data: { ...copy, ...patch, userId } });
    }
    return prisma.tokenDraft.update({ where: { id: row.id }, data: patch });
  }

  return { getOwnedDraft, write };
}
