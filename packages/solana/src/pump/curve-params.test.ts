import { HOUR_MS, MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { assertCurveParams, FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSolanaRpc } from "../rpc.js";
import { PUMP_GLOBAL_ADDRESS, PUMP_PROGRAM_ID } from "./constants.js";
import { createCurveParamsService, readAccountInfo } from "./curve-params.js";
import { decodePumpGlobal } from "./global.js";
import type { PumpAccount } from "./global.js";
import { devnetGlobalAccount, syntheticGlobalAccount } from "./test-helpers.js";

const T0 = Date.parse("2026-09-23T12:00:00Z");
const SECRET_URL = "https://rpc.example.com/?api-key=secret";

function harness(account: PumpAccount | null = syntheticGlobalAccount()) {
  let time = T0;
  const lines = captureLogs();
  const getAccountInfo = vi
    .fn<(address: string) => Promise<PumpAccount | null>>()
    .mockResolvedValue(account);
  const service = createCurveParamsService({ getAccountInfo, now: () => time });
  return {
    ...service,
    getAccountInfo,
    warnings: () => lines.filter((line) => line.includes("curve params fall back")),
    at: (ms: number) => void (time = T0 + ms),
    down: () => getAccountInfo.mockRejectedValue(new Error(`fetch failed: ${SECRET_URL}`)),
  };
}

afterEach(() => {
  setLogDestination(undefined);
  vi.useRealTimers();
});

describe("createCurveParamsService", () => {
  it("reads the Global account and gives its curve params", async () => {
    const { getCurveParams, getAccountInfo, warnings } = harness();

    expect(await getCurveParams()).toEqual({
      curve: FALLBACK_CURVE_PARAMS,
      source: "global",
      fetchedAt: new Date(T0),
    });
    expect(getAccountInfo).toHaveBeenCalledWith(PUMP_GLOBAL_ADDRESS);
    expect(warnings()).toEqual([]);
  });

  it("asks the chain once per hour, and once for concurrent callers", async () => {
    const { getCurveParams, getAccountInfo, at } = harness();

    await Promise.all(Array.from({ length: 10 }, () => getCurveParams()));
    expect(getAccountInfo).toHaveBeenCalledOnce();

    at(HOUR_MS - 1);
    await getCurveParams();
    expect(getAccountInfo).toHaveBeenCalledOnce();

    at(HOUR_MS);
    expect((await getCurveParams()).fetchedAt).toEqual(new Date(T0 + HOUR_MS));
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("serves the last read while the chain fails, with a warning", async () => {
    const { getCurveParams, at, down, warnings } = harness();

    await getCurveParams();
    down();
    at(2 * HOUR_MS);

    expect(await getCurveParams()).toEqual({
      curve: FALLBACK_CURVE_PARAMS,
      source: "stale",
      fetchedAt: new Date(T0),
    });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("rpc_error");
  });

  it.each<[string, PumpAccount | null]>([
    ["account_not_found", null],
    ["wrong_owner", { ...syntheticGlobalAccount(), owner: PUMP_GLOBAL_ADDRESS }],
    [
      "bad_discriminator",
      { owner: PUMP_PROGRAM_ID, data: Buffer.from(syntheticGlobalAccount().data).fill(0, 0, 8) },
    ],
    [
      "decode_error",
      { owner: PUMP_PROGRAM_ID, data: syntheticGlobalAccount().data.subarray(0, 100) },
    ],
    ["invalid_values", syntheticGlobalAccount({ initial_virtual_sol_reserves: 0n })],
    [
      "invalid_values",
      syntheticGlobalAccount({ initial_real_token_reserves: 2_000_000_000_000_000n }),
    ],
    ["invalid_values", devnetGlobalAccount()],
  ])("falls back to the §7.1 table on %s, with one warning", async (reason, account) => {
    const { getCurveParams, warnings } = harness(account);

    const result = await getCurveParams();

    expect(result.curve).toBe(FALLBACK_CURVE_PARAMS);
    expect(result.source).toBe("fallback");
    expect(result.fetchedAt).toEqual(new Date(T0));
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain(reason);
  });

  it("falls back when the RPC rejects, without the RPC URL in the warning", async () => {
    const { getCurveParams, down, warnings } = harness();
    down();

    expect((await getCurveParams()).source).toBe("fallback");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("rpc_error");
    expect(warnings()[0]).not.toContain("api-key=secret");
  });

  it("falls back after 5 s when the RPC does not answer", async () => {
    vi.useFakeTimers();
    const { getCurveParams, getAccountInfo, warnings } = harness();
    getAccountInfo.mockReturnValue(new Promise(() => undefined));

    const pending = getCurveParams();
    await vi.advanceTimersByTimeAsync(5 * SECOND_MS);

    expect((await pending).source).toBe("fallback");
    expect(warnings()[0]).toContain("timeout");
  });

  it("asks the chain again 5 min after a failure, not before", async () => {
    const { getCurveParams, getAccountInfo, at, down } = harness();
    down();

    await getCurveParams();
    at(5 * MINUTE_MS - 1);
    await getCurveParams();
    expect(getAccountInfo).toHaveBeenCalledOnce();

    at(5 * MINUTE_MS);
    getAccountInfo.mockResolvedValue(syntheticGlobalAccount());
    expect((await getCurveParams()).source).toBe("global");
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("forgets its reads on clear", async () => {
    const { getCurveParams, getAccountInfo, clear } = harness();

    await getCurveParams();
    clear();
    await getCurveParams();

    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });
});

describe("readAccountInfo", () => {
  it("reduces the account of web3.js to its owner and its data, null when absent", async () => {
    const data = Buffer.from([1, 2, 3]);
    const getAccountInfo = vi.fn().mockResolvedValue({
      owner: new PublicKey(PUMP_PROGRAM_ID),
      data,
      executable: false,
      lamports: 1,
    });

    expect(await readAccountInfo({ getAccountInfo }, PUMP_GLOBAL_ADDRESS)).toEqual({
      owner: PUMP_PROGRAM_ID,
      data,
    });
    expect(getAccountInfo).toHaveBeenCalledWith(new PublicKey(PUMP_GLOBAL_ADDRESS), "confirmed");

    getAccountInfo.mockResolvedValue(null);
    expect(await readAccountInfo({ getAccountInfo }, PUMP_GLOBAL_ADDRESS)).toBeNull();
  });
});

// Needs the network: RUN_DEVNET_TESTS=1.
describe.skipIf(!process.env["RUN_DEVNET_TESTS"])("pump.fun Global (devnet)", () => {
  const rpc = getSolanaRpc("https://api.devnet.solana.com");

  it("reads and decodes the live account", async () => {
    const account = await readAccountInfo(rpc, PUMP_GLOBAL_ADDRESS);

    expect(account?.owner).toBe(PUMP_PROGRAM_ID);
    const raw = decodePumpGlobal(account);
    expect(raw.tokenTotalSupply).toBe(1_000_000_000_000_000n);
    expect(raw.feeBasisPoints + raw.creatorFeeBasisPoints).toBe(100n);
  }, 30_000);

  it("gives valid curve params, from the chain or from the table", async () => {
    const lines = captureLogs();
    const { getCurveParams } = createCurveParamsService({
      getAccountInfo: (address) => readAccountInfo(rpc, address),
    });

    const result = await getCurveParams();

    expect(() => assertCurveParams(result.curve)).not.toThrow();
    // The devnet Global holds 1 SOL of virtual reserves (30 on mainnet): the service refuses
    // it and the §7.1 table stands in. Mainnet, or a devnet aligned on it, gives `global`.
    expect(["global", "fallback"]).toContain(result.source);
    if (result.source === "fallback") expect(lines.join("\n")).toContain("invalid_values");
  }, 30_000);
});
