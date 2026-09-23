import { CACHE_TTL_MS, createLastKnownValue, SECOND_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import type { CurveParams } from "@launchbot/sim-engine";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { PUMP_GLOBAL_ADDRESS } from "./constants.js";
import { decodePumpGlobal, PumpGlobalError, pumpGlobalToCurveParams } from "./global.js";
import type { PumpAccount } from "./global.js";

const log = createLogger("solana:pump");

/** Proposal: the RPC of the process already gives up after 5 s (`getSolanaRpc`). */
const RPC_TIMEOUT_MS = 5 * SECOND_MS;

/**
 * Where the params come from: the `Global` account read less than an hour ago, the last
 * successful read while the chain fails (`stale`), or the §7.1 table when nothing was
 * ever read (`fallback`).
 */
export type CurveParamsSource = "global" | "stale" | "fallback";

export type CurveParamsResult = {
  curve: CurveParams;
  source: CurveParamsSource;
  /** When the curve was read; for the fallback, when it was handed out. */
  fetchedAt: Date;
};

export type CurveParamsService = {
  /**
   * Never rejects: a simulation recap must not fail because of the Global account. The
   * caller copies `curve` into the simulation (§7.1): a later change on chain never
   * touches a stored one.
   */
  getCurveParams: () => Promise<CurveParamsResult>;
  /** Forgets every read: the next call asks the chain again. */
  clear: () => void;
};

export type CurveParamsDeps = {
  /** `null` when the account does not exist. Rejects on an RPC failure. */
  getAccountInfo: (address: string) => Promise<PumpAccount | null>;
  now?: () => number;
  /** A successful read stands this long: one hour (§7.1). */
  ttlMs?: number;
  /** A failure stands this long before the chain is asked again: 5 min (proposal). */
  fallbackTtlMs?: number;
  timeoutMs?: number;
};

/** The dependency of the service on the connection of the process. */
export async function readAccountInfo(
  rpc: Pick<Connection, "getAccountInfo">,
  address: string,
): Promise<PumpAccount | null> {
  const info = await rpc.getAccountInfo(new PublicKey(address), "confirmed");
  return info && { owner: info.owner.toBase58(), data: info.data };
}

function classify(error: unknown): PumpGlobalError {
  if (error instanceof PumpGlobalError) return error;
  return new PumpGlobalError("rpc_error", "The pump.fun Global account could not be read", {
    cause: error,
  });
}

/**
 * The bonding curve params of every simulation (§7.1): the `Global` account of pump.fun on
 * the cluster of the process, cached one hour and shared by the process (concurrent callers
 * share one read), the §7.1 table when it cannot be read. One `warn` per failed attempt,
 * with a short reason and never the RPC URL.
 */
export function createCurveParamsService(deps: CurveParamsDeps): CurveParamsService {
  const {
    getAccountInfo,
    now,
    ttlMs = CACHE_TTL_MS.pumpGlobal,
    fallbackTtlMs = CACHE_TTL_MS.pumpGlobalFailure,
    timeoutMs = RPC_TIMEOUT_MS,
  } = deps;

  async function load(): Promise<CurveParams> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PumpGlobalError("timeout", `No answer after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    let account: PumpAccount | null;
    try {
      account = await Promise.race([getAccountInfo(PUMP_GLOBAL_ADDRESS), timeout]);
    } catch (error) {
      throw classify(error);
    } finally {
      clearTimeout(timer);
    }
    return pumpGlobalToCurveParams(decodePumpGlobal(account));
  }

  const build = () =>
    createLastKnownValue({
      load,
      ttlMs,
      failureTtlMs: fallbackTtlMs,
      now,
      onFailure: (error) => {
        const failure = classify(error);
        // `err` goes through the scrubber of the logger: a cause quoting the RPC URL loses
        // its query string, and a private URL as a whole.
        log.warn(
          { reason: failure.reason, err: failure.cause ?? failure },
          "pump.fun Global account unusable, curve params fall back",
        );
      },
    });
  let read = build();

  return {
    async getCurveParams() {
      const last = await read();
      if (last === null) {
        return {
          curve: FALLBACK_CURVE_PARAMS,
          source: "fallback",
          fetchedAt: new Date(now?.() ?? Date.now()),
        };
      }
      return {
        curve: last.value,
        source: last.isFallback ? "stale" : "global",
        fetchedAt: new Date(last.loadedAt),
      };
    },
    clear() {
      read = build();
    },
  };
}
