import type { SimulationForViewer, SimulationStore } from "@launchbot/db";
import { API_IMAGE_CACHE_TTL_MS, SECOND_MS, simIdParamSchema } from "@launchbot/shared";
import { consumeRateLimit, TelegramFileError } from "@launchbot/shared/server";
import type { RateLimitedAction } from "@launchbot/shared/server";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { errorBody, httpError } from "../errors.js";
import { toSimulationResponse } from "../services/simulation-read.js";
import type { TokenImageService } from "../services/token-image.js";

export type SimulationRoutesDeps = {
  simulations: Pick<SimulationStore, "findForViewer">;
  images: TokenImageService;
};

/**
 * D17 on the API: the quota of the Telegram user, shared with the bot (`consumeRateLimit`),
 * checked once the initData is valid. Over it: 429 with `Retry-After`.
 */
export const rateLimited =
  (action: RateLimitedAction): preHandlerAsyncHookHandler =>
  async (request, reply) => {
    const verdict = consumeRateLimit(request.telegramUser.id, action);
    if (verdict.ok) return;
    return reply
      .header("retry-after", String(Math.ceil(verdict.retryAfterMs / SECOND_MS)))
      .code(429)
      .send(errorBody(429));
  };

/** The statuses of the failures of the image (V1-23). */
const IMAGE_FAILURE_STATUS = { too_large: 413, unsupported_type: 415, unavailable: 502 } as const;

/**
 * `GET /api/simulations/:id` and `/image` (V1-23, D15). Mounted under `/api`, where every
 * route already requires a Telegram user (V1-05). Checks, in this order: the id (404 for
 * anything but a cuid), the row (404), the owner (403: §15 wants it, and the ids cannot be
 * guessed), then the answer.
 */
export function registerSimulationRoutes(api: FastifyInstance, deps: SimulationRoutesDeps): void {
  const { simulations, images } = deps;

  async function load(request: FastifyRequest): Promise<SimulationForViewer> {
    const params = simIdParamSchema.safeParse(request.params);
    if (!params.success) throw httpError(404, "Not a simulation id");
    const row = await simulations.findForViewer(params.data.id);
    if (row === null) throw httpError(404, `Simulation ${params.data.id} not found`);
    if (row.ownerTelegramId !== BigInt(request.telegramUser.id)) {
      throw httpError(403, `Simulation ${row.id} belongs to another user`);
    }
    return row;
  }

  api.get("/simulations/:id", { preHandler: rateLimited("api") }, async (request, reply) => {
    const row = await load(request);
    let body;
    try {
      body = toSimulationResponse(row);
    } catch (error) {
      // Params the engine refuses, or a draft without name or ticker: only the id is logged.
      request.log.error({ err: error, simId: row.id }, "Stored simulation is invalid");
      return reply.code(500).send(errorBody(500));
    }
    return reply.header("cache-control", "no-store").send(body);
  });

  api.get(
    "/simulations/:id/image",
    { preHandler: rateLimited("apiImage") },
    async (request, reply: FastifyReply) => {
      const row = await load(request);
      const fileId = row.tokenDraft.imageFileId;
      if (fileId === null) throw httpError(404, `Simulation ${row.id} has no image`);
      try {
        const { bytes, contentType } = await images.get(fileId);
        return reply
          .header("content-type", contentType)
          .header("x-content-type-options", "nosniff")
          .header("cache-control", `private, max-age=${API_IMAGE_CACHE_TTL_MS / SECOND_MS}`)
          .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      } catch (error) {
        if (!(error instanceof TelegramFileError)) throw error;
        // The file_id, the token and the URL of Telegram stay out of the logs: only the reason.
        request.log.warn({ reason: error.reason, simId: row.id }, "Token image not served");
        const status = IMAGE_FAILURE_STATUS[error.reason];
        return reply.code(status).send(errorBody(status));
      }
    },
  );
}
