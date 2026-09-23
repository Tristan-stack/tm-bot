import { INIT_DATA_HEADER } from "@launchbot/shared";
import { createRootLogger } from "@launchbot/shared/server";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiServer } from "./server.js";
import type { ApiDeps } from "./server.js";
import {
  OTHER_BOT_TOKEN,
  signInitData,
  telegramUserField,
  TEST_BOT_TOKEN as BOT_TOKEN,
} from "./test-helpers/sign-init-data.js";

const WEBAPP_ORIGIN = "https://launchbot.example.com";
const env = { BOT_TOKEN, WEBAPP_URL: `${WEBAPP_ORIGIN}/` };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

/** The API with routes mounted the way V1-23 mounts them: no preHandler, under /api. */
async function build(deps: Partial<ApiDeps> = {}) {
  const lines: string[] = [];
  const logger = createRootLogger({
    level: "debug",
    destination: { write: (line) => void lines.push(line) },
  });
  app = await buildApiServer({
    env,
    logger,
    routes: (api) => {
      api.get("/me", (request) => ({
        id: request.telegramUser.id,
        authDate: request.initDataAuthDate,
      }));
      api.get("/boom", () => {
        throw new Error(`database exploded at /srv/app/secret-path.ts with ${BOT_TOKEN}`);
      });
      api.get("/forbidden", () => {
        throw httpError(403, "simulation cjld2cjxh0000 belongs to user 42");
      });
      api.get("/limited", () => {
        throw httpError(429, "user 42 exceeded 60 requests");
      });
    },
    ...deps,
  });
  return { app, logs: () => lines.join("") };
}

const forged = () => `user=${telegramUserField()}&hash=${"0".repeat(64)}`;
const signedBy = (token: string, fields: Record<string, string> = {}) => ({
  [INIT_DATA_HEADER]: signInitData({ user: telegramUserField(), ...fields }, token),
});
const validHeader = () => signedBy(BOT_TOKEN);

describe("GET /health", () => {
  it("answers 200 without authentication, and says nothing about the environment", async () => {
    const { app } = await build();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("routes under /api", () => {
  it("give the handler the authenticated user and the date of the initData", async () => {
    const { app } = await build();
    const authDate = Math.floor(Date.now() / 1000) - 10;

    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: signedBy(BOT_TOKEN, { auth_date: String(authDate) }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 5_000_000_001,
      authDate: new Date(authDate * 1000).toISOString(),
    });
  });

  it.each([
    ["no header", {}],
    ["an empty header", { [INIT_DATA_HEADER]: "" }],
    ["a forged header", { [INIT_DATA_HEADER]: forged() }],
    ["data signed for another bot", signedBy(OTHER_BOT_TOKEN)],
    [
      "data older than an hour",
      signedBy(BOT_TOKEN, { auth_date: String(Math.floor(Date.now() / 1000) - 7200) }),
    ],
  ])("are protected without asking for it: the same 401 for %s", async (_label, headers) => {
    const { app } = await build();

    const response = await app.inject({ method: "GET", url: "/api/me", headers });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("log the reason of a refusal, never the header", async () => {
    const { app, logs } = await build();

    await app.inject({ method: "GET", url: "/api/me", headers: { [INIT_DATA_HEADER]: forged() } });

    expect(logs()).toContain('"reason":"bad_hash"');
    expect(logs()).not.toContain("0".repeat(64));
    expect(logs()).not.toContain("first_name");
  });

  it("call onAuthenticated for an authenticated request only", async () => {
    const onAuthenticated = vi.fn();
    const { app } = await build({ onAuthenticated });

    await app.inject({ method: "GET", url: "/api/me" });
    expect(onAuthenticated).not.toHaveBeenCalled();

    await app.inject({ method: "GET", url: "/api/me", headers: validHeader() });
    expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({ id: 5_000_000_001 }));
  });
});

describe("request.telegramUser", () => {
  it("throws on a route that is not protected, instead of giving an undefined user", async () => {
    const { app } = await build();
    app.get("/public-by-mistake", (request) => ({ id: request.telegramUser.id }));

    const response = await app.inject({ method: "GET", url: "/public-by-mistake" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal" });
  });
});

describe("CORS", () => {
  const preflight = (origin: string) => ({
    method: "OPTIONS" as const,
    url: "/api/me",
    headers: {
      origin,
      "access-control-request-method": "GET",
      "access-control-request-headers": INIT_DATA_HEADER,
    },
  });

  it("allows the origin of WEBAPP_URL with the initData header, and lets it be cached", async () => {
    const { app } = await build();

    const response = await app.inject(preflight(WEBAPP_ORIGIN));

    expect(response.headers["access-control-allow-origin"]).toBe(WEBAPP_ORIGIN);
    expect(response.headers["access-control-allow-headers"]).toContain(INIT_DATA_HEADER);
    expect(response.headers["access-control-allow-methods"]).toBe("GET");
    expect(response.headers["access-control-max-age"]).toBe("7200");
  });

  it("gives no Access-Control-Allow-Origin to another origin", async () => {
    const { app } = await build();

    const response = await app.inject(preflight("https://evil.example.com"));

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("errors", () => {
  it("answers 500 without a stack, a message or a secret", async () => {
    const { app, logs } = await build();

    const response = await app.inject({ method: "GET", url: "/api/boom", headers: validHeader() });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal" });
    // The failure is logged for the operator, with the token scrubbed and no stack.
    expect(logs()).toContain('"level":50');
    expect(logs()).not.toContain(BOT_TOKEN);
    expect(logs()).not.toContain('"stack"');
  });

  it.each([
    ["/api/forbidden", 403, "forbidden"],
    ["/api/limited", 429, "rate_limited"],
  ])(
    "lets the 4xx of %s through with a fixed body, never its message",
    async (url, status, error) => {
      const { app, logs } = await build();

      const response = await app.inject({ method: "GET", url, headers: validHeader() });

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error });
      // The fault of the request: not an error of ours in the logs.
      expect(logs()).not.toContain('"level":50');
    },
  );

  it("answers 404 in JSON for an unknown route", async () => {
    const { app } = await build();

    const response = await app.inject({ method: "GET", url: "/api/unknown" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("answers a malformed URL with the same fixed body, not Fastify's own", async () => {
    const { app } = await build();

    const response = await app.inject({ method: "GET", url: "/%zz" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "bad_request" });
  });
});
