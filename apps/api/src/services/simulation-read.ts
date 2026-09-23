import type { SimulationForViewer } from "@launchbot/db";
import { simulationResponseSchema } from "@launchbot/shared";
import type { SimulationResponse } from "@launchbot/shared";

const imagePathOf = (simId: string): string => `/api/simulations/${simId}/image`;

/**
 * The body of `GET /api/simulations/:id` (V1-23). `config` is `Simulation.params` as stored,
 * never recomputed: the replay of a simulation depends on it. Throws (a ZodError) on a row
 * the schema refuses, params corrupted or a draft without name or ticker: the route answers
 * 500. Never a userId, a telegramId, a tokenDraftId or a file_id.
 */
export function toSimulationResponse(row: SimulationForViewer): SimulationResponse {
  const { tokenDraft: draft } = row;
  return simulationResponseSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    config: row.params,
    token: {
      name: draft.name,
      ticker: draft.symbol,
      description: draft.description,
      hasImage: draft.imageFileId !== null,
      imagePath: draft.imageFileId === null ? null : imagePathOf(row.id),
      links: { website: draft.website, x: draft.twitter, telegram: draft.telegram },
    },
  });
}
