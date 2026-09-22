import { MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoinGeckoProvider } from "./coingecko.js";
import { createSolUsdPrice } from "./sol-usd.js";

const T0 = Date.parse("2026-09-21T12:00:00Z");

function harness() {
  let time = T0;
  const lines = captureLogs();
  const fetchUsd = vi.fn<(signal: AbortSignal) => Promise<number>>().mockResolvedValue(103.36);
  const price = createSolUsdPrice({ provider: { name: "fake", fetchUsd }, now: () => time });
  return {
    ...price,
    fetchUsd,
    lines,
    at: (ms: number) => void (time = T0 + ms),
    down: () => fetchUsd.mockRejectedValue(new Error("fetch failed")),
  };
}

afterEach(() => {
  setLogDestination(undefined);
});

describe("createSolUsdPrice", () => {
  it("calls the provider once for two reads 59 s apart, and again after 60 s", async () => {
    const { getSolUsdPrice, fetchUsd, at } = harness();

    expect(await getSolUsdPrice()).toBe(103.36);
    at(59 * SECOND_MS);
    expect(await getSolUsdPrice()).toBe(103.36);
    expect(fetchUsd).toHaveBeenCalledOnce();

    at(60 * SECOND_MS);
    await getSolUsdPrice();
    expect(fetchUsd).toHaveBeenCalledTimes(2);
  });

  it("gives the age of the price, and says when it is a fallback", async () => {
    const { getSolUsdQuote, at, down } = harness();

    expect(await getSolUsdQuote()).toEqual({
      price: 103.36,
      fetchedAt: new Date(T0),
      isFallback: false,
    });
    down();
    at(9 * MINUTE_MS);

    expect(await getSolUsdQuote()).toEqual({
      price: 103.36,
      fetchedAt: new Date(T0),
      isFallback: true,
    });
  });

  it("serves the last price 9 min after it, with a warning, and null after 10 min", async () => {
    const { getSolUsdPrice, lines, at, down } = harness();
    await getSolUsdPrice();
    down();

    at(9 * MINUTE_MS);
    expect(await getSolUsdPrice()).toBe(103.36);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":40');

    at(10 * MINUTE_MS);
    expect(await getSolUsdPrice()).toBeNull();
  });

  it("returns null when the provider has never answered", async () => {
    const { getSolUsdPrice, down } = harness();
    down();

    expect(await getSolUsdPrice()).toBeNull();
  });

  it("does not call a failing provider again for 60 s", async () => {
    const { getSolUsdPrice, fetchUsd, at, down } = harness();
    down();

    await getSolUsdPrice();
    at(59 * SECOND_MS);
    await getSolUsdPrice();
    expect(fetchUsd).toHaveBeenCalledOnce();

    at(60 * SECOND_MS);
    await getSolUsdPrice();
    expect(fetchUsd).toHaveBeenCalledTimes(2);
  });

  it("measures the age of the fallback on every read, even with no new call", async () => {
    const { getSolUsdPrice, fetchUsd, at, down } = harness();
    await getSolUsdPrice();
    down();

    at(9 * MINUTE_MS + 30 * SECOND_MS);
    expect(await getSolUsdPrice()).toBe(103.36);
    // The failure is still cached: the provider is not asked, yet the price is now too old.
    at(10 * MINUTE_MS + 10 * SECOND_MS);
    expect(await getSolUsdPrice()).toBeNull();
    expect(fetchUsd).toHaveBeenCalledTimes(2);
  });

  it("recovers as soon as the provider answers again", async () => {
    const { getSolUsdQuote, fetchUsd, at, down } = harness();
    down();
    await getSolUsdQuote();

    fetchUsd.mockResolvedValue(110);
    at(MINUTE_MS);

    expect(await getSolUsdQuote()).toMatchObject({ price: 110, isFallback: false });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a price of %s", async (bad) => {
    const { getSolUsdPrice, fetchUsd } = harness();
    fetchUsd.mockResolvedValue(bad);

    expect(await getSolUsdPrice()).toBeNull();
  });
});

describe("createCoinGeckoProvider", () => {
  const answering = (body: string, status = 200) =>
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));
  const signal = new AbortController().signal;

  it("reads the price of a Simple Price answer", async () => {
    const fetchFn = answering('{"solana":{"usd":103.36}}');

    const price = await createCoinGeckoProvider("https://price.example.com", fetchFn).fetchUsd(
      signal,
    );

    expect(price).toBe(103.36);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://price.example.com");
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  it.each([
    ["a negative price", '{"solana":{"usd":-1}}'],
    ["another shape", '{"sol":1}'],
    ["invalid JSON", "<html>"],
  ])("rejects %s", async (_label, body) => {
    await expect(
      createCoinGeckoProvider(undefined, answering(body)).fetchUsd(signal),
    ).rejects.toThrow();
  });

  it("rejects a status other than 200 without quoting the URL", async () => {
    const provider = createCoinGeckoProvider(
      "https://price.example.com/?x_cg_pro_api_key=SECRET",
      answering("{}", 429),
    );

    const error = await provider.fetchUsd(signal).catch((cause: unknown) => cause);

    expect(String(error)).toContain("429");
    expect(String(error)).not.toContain("SECRET");
  });
});
