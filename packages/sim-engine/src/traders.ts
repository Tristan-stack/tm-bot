import { pickWeighted } from "./distributions.js";
import type { Rng } from "./rng.js";

/** The base58 alphabet of Solana addresses: no 0, O, I or l. */
export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ADDRESS_HALF = 4;

export type Trader = { address: string; tokens: number };

/**
 * The simulated traders in creation order (§7.2): fake short addresses drawn from the seed,
 * never real keys, in the same `ABCD…EFGH` shape as the short addresses of the bot (V1-03).
 * Holdings are settled by the flow: a trader holds either 0 or more than the dust.
 */
export class TraderRegistry {
  readonly #addressRng: Rng;
  readonly #traders: Trader[] = [];
  readonly #addresses = new Set<string>();

  constructor(addressRng: Rng) {
    this.#addressRng = addressRng;
  }

  /** A new trader with a fresh address, drawn again on a collision. */
  create(): Trader {
    let address = this.#drawAddress();
    while (this.#addresses.has(address)) address = this.#drawAddress();
    this.#addresses.add(address);
    const trader = { address, tokens: 0 };
    this.#traders.push(trader);
    return trader;
  }

  /** The trader at floor(u · n), uniform among all the known ones, even at 0 token. */
  pickAny(u: number): Trader | undefined {
    return this.#traders[Math.floor(u * this.#traders.length)];
  }

  /** A holder picked in proportion to its holdings, or undefined when nobody holds. */
  pickHolder(u: number): Trader | undefined {
    return pickWeighted(this.#traders, (trader) => trader.tokens, u);
  }

  /** The live list, in creation order: read it, never keep it across a trade. */
  list(): ReadonlyArray<Readonly<Trader>> {
    return this.#traders;
  }

  /** Whoever holds tokens, the biggest first (creation order on a tie), to be traded on. */
  holders(): Trader[] {
    return this.#traders.filter((trader) => trader.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  }

  #drawAddress(): string {
    let chars = "";
    for (let i = 0; i < ADDRESS_HALF * 2; i += 1) {
      chars += BASE58_ALPHABET[this.#addressRng.int(BASE58_ALPHABET.length)] ?? "";
    }
    return `${chars.slice(0, ADDRESS_HALF)}…${chars.slice(ADDRESS_HALF)}`;
  }
}
