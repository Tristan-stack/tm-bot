import type { Prisma, PrismaClient, Simulation } from "../generated/prisma/client.js";

export type { Simulation } from "../generated/prisma/client.js";

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
  };
}
