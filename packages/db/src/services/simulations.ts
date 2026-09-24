import type { Prisma, PrismaClient, Simulation } from "../generated/prisma/client.js";
import type { TokenDraftFields } from "./token-drafts.js";

export type { Simulation } from "../generated/prisma/client.js";

/** A Simulation with the token it shows: what the chat needs to run it (V1-26). */
export type SimulationWithDraft = Simulation & { tokenDraft: TokenDraftFields };

const DRAFT_FIELDS = {
  name: true,
  symbol: true,
  description: true,
  imageFileId: true,
  website: true,
  twitter: true,
  telegram: true,
} as const satisfies Record<keyof TokenDraftFields, true>;

export type SimulationKey = { userId: string; tokenDraftId: string; devBuySol: number };

export type NewSimulation = SimulationKey & {
  seed: number;
  /** The whole `SimConfig` of §7.4, validated by the caller. */
  params: Prisma.InputJsonObject;
};

/** The rows of `Simulation` (§13). The rules of reuse and the seed are the bot's (V1-22). */
export type SimulationStore = {
  /** The latest simulation of this user, draft and dev buy, created after `since`. */
  findLatest: (key: SimulationKey, since: Date) => Promise<Simulation | null>;
  create: (data: NewSimulation) => Promise<Simulation>;
  /** This user's simulation by id, with its draft: null when not theirs, unknown or purged. */
  findOwnedWithDraft: (userId: string, simId: string) => Promise<SimulationWithDraft | null>;
};

export type SimulationsDeps = { prisma: PrismaClient };

/** `devBuySol` is a Decimal column: the number goes through its decimal text, never a float. */
const decimalOf = (sol: number): string => sol.toString();

export function createSimulationStore({ prisma }: SimulationsDeps): SimulationStore {
  return {
    findLatest: ({ userId, tokenDraftId, devBuySol }, since) =>
      prisma.simulation.findFirst({
        where: { userId, tokenDraftId, devBuySol: decimalOf(devBuySol), createdAt: { gt: since } },
        orderBy: { createdAt: "desc" },
      }),

    create: ({ userId, tokenDraftId, devBuySol, seed, params }) =>
      prisma.simulation.create({
        data: { userId, tokenDraftId, devBuySol: decimalOf(devBuySol), seed, params },
      }),

    findOwnedWithDraft: (userId, simId) =>
      prisma.simulation.findFirst({
        where: { id: simId, userId },
        include: { tokenDraft: { select: DRAFT_FIELDS } },
      }),
  };
}
