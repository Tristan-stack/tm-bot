import { CACHE_TTL_MS, createTtlCache } from "@launchbot/shared";
import type { TtlCache } from "@launchbot/shared";
import type { Lamports, TxRpc } from "./types.js";

export type RentReader = Pick<TxRpc, "getMinimumBalanceForRentExemption">;

/**
 * One cache per connection, weakly held: the process has a single `Connection`, and a fake RPC
 * in a test starts with an empty one. The cache shares a load between readers that ask at
 * once, and never keeps a failure.
 */
const caches = new WeakMap<RentReader, TtlCache<"rentMin", Lamports>>();

/**
 * The balance an account must keep to exist: 890 880 lamports for an empty account on devnet,
 * read from the chain and never written down (§9.5). It only changes with a cluster parameter,
 * so it is kept for `CACHE_TTL_MS.rentMin`. The clock is the one of the first reader of a
 * connection — a test seam, `Date.now` otherwise.
 */
export function getRentExemptMinimum(rpc: RentReader, now?: () => number): Promise<Lamports> {
  let cache = caches.get(rpc);
  if (cache === undefined) {
    cache = createTtlCache({ ttlMs: CACHE_TTL_MS.rentMin, now });
    caches.set(rpc, cache);
  }
  return cache.get("rentMin", async () => {
    const lamports = await rpc.getMinimumBalanceForRentExemption(0, "confirmed");
    // web3.js answers 0 to a JSON-RPC error: an empty account is never free to keep.
    if (lamports <= 0) throw new Error("The RPC gave no rent-exempt minimum");
    return BigInt(lamports);
  });
}
