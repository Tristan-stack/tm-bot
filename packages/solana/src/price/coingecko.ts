import { z } from "zod";
import type { SolPriceProvider } from "./sol-usd.js";

/** No API key: one call a minute stays under the public limits (D11). */
const COINGECKO_SOL_USD_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

/** `{"solana":{"usd":103.36}}` */
const responseSchema = z.object({ solana: z.object({ usd: z.number().positive() }) });

/** CoinGecko Simple Price. `url` is `SOL_PRICE_API_URL`: another host must answer the same shape. */
export const createCoinGeckoProvider = (
  url: string = COINGECKO_SOL_USD_URL,
  fetchFn: typeof fetch = fetch,
): SolPriceProvider => ({
  name: "coingecko",
  async fetchUsd(signal) {
    const response = await fetchFn(url, { signal, headers: { accept: "application/json" } });
    // The URL is left out of the message: a paid plan carries its key in the query string.
    if (!response.ok) throw new Error(`Price provider answered HTTP ${response.status}`);
    return responseSchema.parse(await response.json()).solana.usd;
  },
});
