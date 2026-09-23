import { CACHE_TTL_MS, createLastKnownValue } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import type { CurveParams } from "@launchbot/sim-engine";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { RpcUnavailableError } from "../rpc.js";
import { PUMP_GLOBAL_ADDRESS } from "./constants.js";
import { decodePumpGlobal, PumpGlobalError, pumpGlobalToCurveParams } from "./global.js";
import type { PumpAccount } from "./global.js";

const log = createLogger("solana:pump");

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
};

export type CurveParamsDeps = {
  /**
   * `null` when the account does not exist. Rejects on an RPC failure: `readAccountInfo` on
   * the connection of the process, whose `fetch` gives up after 5 s (`getSolanaRpc`).
   */
  getAccountInfo: (address: string) => Promise<PumpAccount | null>;
  now?: () => number;
};

/** The dependency of the service on the connection of the process. */
export async function readAccountInfo(
  rpc: Pick<Connection, "getAccountInfo">,
  address: string,
): Promise<PumpAccount | null> {
  const info = await rpc.getAccountInfo(new PublicKey(address), "confirmed");
  return info && { owner: info.owner.toBase58(), data: info.data };
}

const isTimeout = (error: RpcUnavailableError): boolean =>
  (error.cause as { name?: unknown } | undefined)?.name === "TimeoutError";

/** The failure of a read, by reason: the checks of the decoder, or the transport. */
function classify(error: unknown): PumpGlobalError {
  if (error instanceof PumpGlobalError) return error;
  const reason = error instanceof RpcUnavailableError && isTimeout(error) ? "timeout" : "rpc_error";
  return new PumpGlobalError(reason, "The pump.fun Global account could not be read", {
    cause: error,
  });
}

/**
 * The bonding curve params of every simulation (§7.1): the `Global` account of pump.fun on
 * the cluster of the process, cached one hour (`CACHE_TTL_MS.pumpGlobal`) and shared by the
 * process (concurrent callers share one read), the §7.1 table when it cannot be read, a
 * failure kept 5 min (`pumpGlobalFailure`) before the chain is asked again. One `warn` per
 * failed attempt, with a short reason and never the RPC URL.
 */
export function createCurveParamsService(deps: CurveParamsDeps): CurveParamsService {
  const { getAccountInfo, now = Date.now } = deps;

  async function load(): Promise<CurveParams> {
    let account: PumpAccount | null;
    try {
      account = await getAccountInfo(PUMP_GLOBAL_ADDRESS);
    } catch (error) {
      throw classify(error);
    }
    return pumpGlobalToCurveParams(decodePumpGlobal(account));
  }

  const read = createLastKnownValue({
    load,
    ttlMs: CACHE_TTL_MS.pumpGlobal,
    failureTtlMs: CACHE_TTL_MS.pumpGlobalFailure,
    now,
    onFailure: (error) => {
      // `load` only ever throws a PumpGlobalError. `err` goes through the scrubber of the
      // logger: a cause quoting the RPC URL loses its query string, a private URL as a whole.
      const failure = error as PumpGlobalError;
      log.warn(
        { reason: failure.reason, err: failure.cause ?? failure },
        "pump.fun Global account unusable, curve params fall back",
      );
    },
  });

  return {
    async getCurveParams() {
      const last = await read();
      if (last === null) {
        return { curve: FALLBACK_CURVE_PARAMS, source: "fallback", fetchedAt: new Date(now()) };
      }
      return {
        curve: last.value,
        source: last.isFallback ? "stale" : "global",
        fetchedAt: new Date(last.loadedAt),
      };
    },
  };
}
