import { CACHE_TTL_MS, createLastKnownValue, SECOND_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";

const log = createLogger("solana:price");

/** One adapter is implemented (CoinGecko, D11); another provider only has to fit this. */
export type SolPriceProvider = {
  name: string;
  /** Rejects on a network error, a status other than 200 or a body it cannot read. */
  fetchUsd: (signal: AbortSignal) => Promise<number>;
};

export type SolUsdQuote = {
  price: number;
  fetchedAt: Date;
  /** The provider is failing: this is the last known price, less than 10 minutes old. */
  isFallback: boolean;
};

export type SolUsdPrice = {
  /**
   * `null`: no usable price. Callers then hide every USD amount, show `SOL —` on the home
   * screen (V1-08) and create no invoice (V1-28).
   */
  getSolUsdPrice: () => Promise<number | null>;
  /** The price with its age, for what freezes it: an invoice (V1-28), a simulation (V1-22). */
  getSolUsdQuote: () => Promise<SolUsdQuote | null>;
};

/** Proposal. */
const FETCH_TIMEOUT_MS = 3 * SECOND_MS;

export function createSolUsdPrice(deps: {
  provider: SolPriceProvider;
  now?: () => number;
}): SolUsdPrice {
  const { provider, now } = deps;

  // At most one call to the provider per minute, failures included: an API that is down is
  // not hammered. The last price stands in for 10 minutes.
  const read = createLastKnownValue({
    ttlMs: CACHE_TTL_MS.solPrice,
    maxStaleMs: CACHE_TTL_MS.solPriceMaxStale,
    now,
    async load() {
      const price = await provider.fetchUsd(AbortSignal.timeout(FETCH_TIMEOUT_MS));
      if (!Number.isFinite(price) || price <= 0) throw new Error("Price out of range");
      return price;
    },
    onFailure: (error) =>
      log.warn({ err: error, provider: provider.name }, "SOL/USD price fetch failed"),
  });

  async function getSolUsdQuote(): Promise<SolUsdQuote | null> {
    const last = await read();
    return (
      last && { price: last.value, fetchedAt: new Date(last.loadedAt), isFallback: last.isFallback }
    );
  }

  return {
    getSolUsdQuote,
    getSolUsdPrice: async () => (await getSolUsdQuote())?.price ?? null,
  };
}
