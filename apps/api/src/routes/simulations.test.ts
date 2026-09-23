import type { SimulationForViewer } from "@launchbot/db";
import { INIT_DATA_HEADER, RATE_LIMITS, simulationResponseSchema } from "@launchbot/shared";
import { createRootLogger, resetRateLimits, TelegramFileError } from "@launchbot/shared/server";
import type { TelegramFile } from "@launchbot/shared/server";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApiServer } from "../server.js";
import {
  signInitData,
  telegramUserField,
  TEST_BOT_TOKEN as BOT_TOKEN,
} from "../test-helpers/sign-init-data.js";
import { registerSimulationRoutes } from "./simulations.js";

const WEBAPP_ORIGIN = "https://launchbot.example.com";
const OWNER = 5_000_000_001;
const SIM_ID = "cmfz1abcd0000abcdefghijkl";
const FILE_ID = "AgACAgIAAxkBAAIB-secret-file-id";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const CONFIG = {
  seed: 1234567,
  devBuySol: 5,
  durationSec: 180,
  curve: {
    virtualSol: 30,
    virtualTokens: 1_073_000_000,
    realTokens: 793_100_000,
    totalSupply: 1_000_000_000,
    feeRate: 0.01,
  },
  preset: { lambda0: 1.2, pBuy: 0.58, mu: -1.386, sigma: 1, minTrade: 0.01, maxTrade: 5 },
  solUsdPrice: 103.36,
};

const row = (overrides: Partial<SimulationForViewer> = {}): SimulationForViewer => ({
  id: SIM_ID,
  createdAt: new Date("2026-09-23T14:32:05.000Z"),
  params: CONFIG,
  ownerTelegramId: BigInt(OWNER),
  tokenDraft: {
    name: "Moon Otter",
    symbol: "OTTR",
    description: "An otter who loves the stars.",
    imageFileId: FILE_ID,
    website: null,
    twitter: "https://x.com/moonotter",
    telegram: null,
  },
  ...overrides,
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
beforeEach(resetRateLimits);

async function build(
  rows: SimulationForViewer[] = [row()],
  image: TelegramFile | Error = { bytes: JPEG, contentType: "image/jpeg" },
) {
  const lines: string[] = [];
  const logger = createRootLogger({
    level: "debug",
    destination: { write: (line) => void lines.push(line) },
  });
  const findForViewer = vi.fn((id: string) =>
    Promise.resolve(rows.find((r) => r.id === id) ?? null),
  );
  const get = vi.fn(() =>
    image instanceof Error ? Promise.reject(image) : Promise.resolve(image),
  );
  app = await buildApiServer({
    env: { BOT_TOKEN, WEBAPP_URL: WEBAPP_ORIGIN },
    logger,
    routes: (api) =>
      registerSimulationRoutes(api, { simulations: { findForViewer }, images: { get } }),
  });
  return { app, findForViewer, images: get, logs: () => lines.join("") };
}

const asUser = (id: number) => ({
  [INIT_DATA_HEADER]: signInitData({ user: telegramUserField({ id }) }, BOT_TOKEN),
});
const owner = () => asUser(OWNER);
const get = (url: string, headers: Record<string, string> = owner()) =>
  app!.inject({ method: "GET", url, headers });

describe("GET /api/simulations/:id", () => {
  it("answers the owner with the stored config and the token, never an id of the account", async () => {
    await build();

    const response = await get(`/api/simulations/${SIM_ID}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = simulationResponseSchema.parse(response.json());
    expect(body).toEqual({
      id: SIM_ID,
      createdAt: "2026-09-23T14:32:05.000Z",
      config: CONFIG,
      token: {
        name: "Moon Otter",
        ticker: "OTTR",
        description: "An otter who loves the stars.",
        hasImage: true,
        imagePath: `/api/simulations/${SIM_ID}/image`,
        links: { website: null, x: "https://x.com/moonotter", telegram: null },
      },
    });
    const text = response.body;
    for (const secret of ["userId", "telegramId", "tokenDraftId", FILE_ID, String(OWNER)]) {
      expect(text).not.toContain(secret);
    }
  });

  it("gives null for a missing image and for a link that is not https", async () => {
    await build([
      row({
        tokenDraft: {
          ...row().tokenDraft,
          imageFileId: null,
          website: "javascript:alert(1)",
          telegram: "http://t.me/moonotter",
        },
      }),
    ]);

    const { token } = simulationResponseSchema.parse(
      (await get(`/api/simulations/${SIM_ID}`)).json(),
    );

    expect(token.hasImage).toBe(false);
    expect(token.imagePath).toBeNull();
    expect(token.links).toEqual({ website: null, x: "https://x.com/moonotter", telegram: null });
  });

  it.each([
    ["no header", {}],
    [
      "a forged header",
      { [INIT_DATA_HEADER]: `user=${telegramUserField()}&hash=${"0".repeat(64)}` },
    ],
    [
      "an expired header",
      {
        [INIT_DATA_HEADER]: signInitData(
          { user: telegramUserField(), auth_date: String(Math.floor(Date.now() / 1000) - 7200) },
          BOT_TOKEN,
        ),
      },
    ],
  ])("answers 401 for %s without touching the database", async (_label, headers) => {
    const { findForViewer } = await build();

    const response = await get(`/api/simulations/${SIM_ID}`, headers);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(findForViewer).not.toHaveBeenCalled();
  });

  it("answers 403 to another user, with a User row or not", async () => {
    await build();

    const response = await get(`/api/simulations/${SIM_ID}`, asUser(4_242));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
  });

  it.each([
    ["an unknown id", "cmfz1zzzz0000zzzzzzzzzzzz"],
    ["a malformed id", "not-an-id"],
    ["an empty-looking id", "%20"],
  ])("answers 404 for %s", async (_label, id) => {
    const { findForViewer } = await build();

    const response = await get(`/api/simulations/${id}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    if (id === "not-an-id") expect(findForViewer).not.toHaveBeenCalled();
  });

  it("answers 500 for params the schema refuses, with the id only in the logs", async () => {
    const { logs } = await build([row({ params: { ...CONFIG, seed: -1 } })]);

    const response = await get(`/api/simulations/${SIM_ID}`);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal" });
    expect(logs()).toContain(`"simId":"${SIM_ID}"`);
    expect(logs()).toContain('"level":50');
  });

  it("answers 429 with Retry-After over the limit of the user, not of another user", async () => {
    await build();
    for (let i = 0; i < RATE_LIMITS.api.limit; i += 1) {
      expect((await get(`/api/simulations/${SIM_ID}`)).statusCode).toBe(200);
    }

    const refused = await get(`/api/simulations/${SIM_ID}`);

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "rate_limited" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect((await get(`/api/simulations/${SIM_ID}`, asUser(4_242))).statusCode).toBe(403);
  });

  it("lets the Mini App preflight the route with the initData header", async () => {
    await build();

    const response = await app!.inject({
      method: "OPTIONS",
      url: `/api/simulations/${SIM_ID}`,
      headers: {
        origin: WEBAPP_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": INIT_DATA_HEADER,
      },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(WEBAPP_ORIGIN);
    expect(response.headers["access-control-allow-headers"]).toContain(INIT_DATA_HEADER);
  });
});

describe("GET /api/simulations/:id/image", () => {
  const url = `/api/simulations/${SIM_ID}/image`;

  it("serves the bytes with their type, nosniff and a private cache", async () => {
    const { images } = await build();

    const response = await get(url);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    expect(response.headers["location"]).toBeUndefined();
    expect(new Uint8Array(response.rawPayload)).toEqual(JPEG);
    expect(images).toHaveBeenCalledWith(FILE_ID);
  });

  it("applies the same 401, 403 and 404", async () => {
    await build([
      row(),
      row({
        id: "cmfz1noimg0000abcdefghijkl",
        tokenDraft: { ...row().tokenDraft, imageFileId: null },
      }),
    ]);

    expect((await get(url, {})).statusCode).toBe(401);
    expect((await get(url, asUser(4_242))).statusCode).toBe(403);
    expect((await get("/api/simulations/cmfz1zzzz0000zzzzzzzzzzzz/image")).statusCode).toBe(404);
    const noImage = await get("/api/simulations/cmfz1noimg0000abcdefghijkl/image");
    expect(noImage.statusCode).toBe(404);
    expect(noImage.json()).toEqual({ error: "not_found" });
  });

  it.each([
    ["unsupported_type", 415, "unsupported_image"],
    ["too_large", 413, "image_too_large"],
    ["unavailable", 502, "image_unavailable"],
  ] as const)(
    "answers a failure %s of Telegram with %s, and leaks nothing",
    async (reason, status, error) => {
      const failure = new TelegramFileError(reason, "Telegram getFile answered 400", {
        cause: new Error(
          `GET https://api.telegram.org/file/bot${BOT_TOKEN}/photos/file_1.jpg failed for ${FILE_ID}`,
        ),
      });
      const { logs } = await build([row()], failure);

      const response = await get(url);

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error });
      const everything = `${response.body}${JSON.stringify(response.headers)}${logs()}`;
      expect(everything).not.toContain(BOT_TOKEN);
      expect(everything).not.toContain("api.telegram.org");
      expect(everything).not.toContain(FILE_ID);
      expect(logs()).toContain(`"reason":"${reason}"`);
    },
  );

  it("has its own limit", async () => {
    await build();
    for (let i = 0; i < RATE_LIMITS.apiImage.limit; i += 1) {
      expect((await get(url)).statusCode).toBe(200);
    }

    expect((await get(url)).statusCode).toBe(429);
    // The JSON route keeps its own quota.
    expect((await get(`/api/simulations/${SIM_ID}`)).statusCode).toBe(200);
  });
});
