import { INIT_DATA_HEADER } from "@launchbot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { getWebApp, initTelegramWebApp } from "./telegram";
import { insideTelegram } from "./test-helpers/telegram";

const schema = { parse: (data: unknown) => data as { id: string } };

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

const failsWith = (promise: Promise<unknown>, status: number | string) =>
  expect(promise).rejects.toMatchObject({ name: "ApiError", status });

afterEach(() => {
  delete window.Telegram;
  vi.restoreAllMocks();
});

describe("outside Telegram", () => {
  it("has no WebApp object and does not crash", () => {
    expect(getWebApp()).toBeUndefined();
    expect(() => initTelegramWebApp()).not.toThrow();
  });

  it("refuses an API call with 401 without touching the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await failsWith(apiFetch("/api/simulations/x", schema), 401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does the same when Telegram gives an empty initData", async () => {
    insideTelegram({ initData: "" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await failsWith(apiFetch("/api/simulations/x", schema), 401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("inside Telegram", () => {
  it("tells Telegram the app is ready, then expands it", () => {
    const { webApp } = insideTelegram();

    initTelegramWebApp();

    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
  });

  it("sends the raw initData in the initData header and returns the parsed body", async () => {
    const { webApp } = insideTelegram();
    const fetchSpy = respond(200, { id: "sim1" });

    const body = await apiFetch("/api/simulations/sim1", schema);

    expect(body).toEqual({ id: "sim1" });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/simulations\/sim1$/);
    expect(init?.headers).toEqual({ [INIT_DATA_HEADER]: webApp.initData });
  });

  it.each([401, 404, 500])("throws ApiError with the status %d", async (status) => {
    insideTelegram();
    respond(status, { error: "x" });

    await failsWith(apiFetch("/api/simulations/x", schema), status);
  });

  it("reports an unreachable API as a network error", async () => {
    insideTelegram();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await failsWith(apiFetch("/api/simulations/x", schema), "network");
  });

  it("reports an answer that does not match the schema", async () => {
    insideTelegram();
    respond(200, { unexpected: true });
    const strict = {
      parse: () => {
        throw new Error("invalid shape");
      },
    };

    await failsWith(apiFetch("/api/simulations/x", strict), "invalid");
  });
});
