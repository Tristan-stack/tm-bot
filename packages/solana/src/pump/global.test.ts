import { DEV_BUY_MAX_SOL } from "@launchbot/shared";
import { devBuySupplyShare, FALLBACK_CURVE_PARAMS } from "@launchbot/sim-engine";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { PUMP_GLOBAL_ADDRESS, PUMP_PROGRAM_ID } from "./constants.js";
import {
  decodePumpGlobal,
  GLOBAL_DISCRIMINATOR,
  GLOBAL_MIN_SIZE,
  globalFieldOffset,
  pumpGlobalToCurveParams,
} from "./global.js";
import { pumpSdk } from "./sdk.js";
import { DEVNET_FIXTURE, devnetGlobalAccount, syntheticGlobalAccount } from "./test-helpers.js";

describe("pump.fun addresses", () => {
  it('derives the Global address from the seed "global" of the program', () => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global")],
      new PublicKey(PUMP_PROGRAM_ID),
    );

    expect(pda.toBase58()).toBe(PUMP_GLOBAL_ADDRESS);
    expect(pumpSdk.PUMP_PROGRAM_ID.toBase58()).toBe(PUMP_PROGRAM_ID);
    expect(pumpSdk.GLOBAL_PDA.toBase58()).toBe(PUMP_GLOBAL_ADDRESS);
  });

  it("reads the discriminator and the minimum size from the IDL", () => {
    expect([...GLOBAL_DISCRIMINATOR]).toEqual([167, 232, 232, 177, 200, 108, 114, 127]);
    // 8 + bool + 2 pubkeys + 5 u64 + pubkey + bool + 2 u64
    expect(globalFieldOffset("initial_virtual_token_reserves")).toBe(8 + 1 + 32 + 32);
    expect(GLOBAL_MIN_SIZE).toBe(162);
    expect(GLOBAL_MIN_SIZE).toBeLessThan(DEVNET_FIXTURE.space);
  });
});

describe("decodePumpGlobal", () => {
  it("decodes the devnet fixture", () => {
    expect(DEVNET_FIXTURE.address).toBe(PUMP_GLOBAL_ADDRESS);
    expect(DEVNET_FIXTURE.owner).toBe(PUMP_PROGRAM_ID);

    expect(decodePumpGlobal(devnetGlobalAccount())).toEqual({
      initialVirtualSolReserves: 1_000_000_000n,
      initialVirtualTokenReserves: 1_073_000_000_000_000n,
      initialRealTokenReserves: 793_100_000_000_000n,
      tokenTotalSupply: 1_000_000_000_000_000n,
      feeBasisPoints: 95n,
      creatorFeeBasisPoints: 5n,
    });
  });

  it("accepts an account longer than the IDL layout", () => {
    const account = devnetGlobalAccount();
    const longer = { ...account, data: Buffer.concat([account.data, Buffer.alloc(64)]) };

    expect(decodePumpGlobal(longer)).toEqual(decodePumpGlobal(account));
  });

  it("names the failed check", () => {
    const account = syntheticGlobalAccount();
    const withData = (data: Uint8Array) => ({ owner: account.owner, data });
    const badDiscriminator = Buffer.from(account.data);
    badDiscriminator.writeUInt8(badDiscriminator.readUInt8(0) ^ 1, 0);

    expect(() => decodePumpGlobal(null)).toThrow(
      expect.objectContaining({ reason: "account_not_found" }),
    );
    expect(() => decodePumpGlobal({ ...account, owner: PUMP_GLOBAL_ADDRESS })).toThrow(
      expect.objectContaining({ reason: "wrong_owner" }),
    );
    expect(() => decodePumpGlobal(withData(badDiscriminator))).toThrow(
      expect.objectContaining({ reason: "bad_discriminator" }),
    );
    expect(() => decodePumpGlobal(withData(account.data.subarray(0, 4)))).toThrow(
      expect.objectContaining({ reason: "bad_discriminator" }),
    );
    expect(() => decodePumpGlobal(withData(account.data.subarray(0, GLOBAL_MIN_SIZE - 1)))).toThrow(
      expect.objectContaining({ reason: "decode_error" }),
    );
    expect(decodePumpGlobal(withData(account.data.subarray(0, GLOBAL_MIN_SIZE)))).toBeDefined();
  });
});

describe("pumpGlobalToCurveParams", () => {
  it("converts lamports, base units and basis points into the §7.1 values", () => {
    expect(pumpGlobalToCurveParams(decodePumpGlobal(syntheticGlobalAccount()))).toEqual({
      virtualSol: 30,
      virtualTokens: 1_073_000_000,
      realTokens: 793_100_000,
      totalSupply: 1_000_000_000,
      feeRate: 0.01,
    });
    expect(pumpGlobalToCurveParams(decodePumpGlobal(syntheticGlobalAccount()))).toEqual(
      FALLBACK_CURVE_PARAMS,
    );
  });

  it("adds the creator fee to the protocol fee", () => {
    const raw = decodePumpGlobal(
      syntheticGlobalAccount({ fee_basis_points: 100n, creator_fee_basis_points: 0n }),
    );
    expect(pumpGlobalToCurveParams(raw).feeRate).toBe(0.01);

    const withCreator = decodePumpGlobal(
      syntheticGlobalAccount({ fee_basis_points: 125n, creator_fee_basis_points: 30n }),
    );
    expect(pumpGlobalToCurveParams(withCreator).feeRate).toBeCloseTo(0.0155, 12);
  });

  it("gives ≈ 96.66M tokens (9.67 %) to a 3 SOL dev buy and ≈ 15.2 % to 5 SOL", () => {
    const curve = pumpGlobalToCurveParams(decodePumpGlobal(syntheticGlobalAccount()));

    const three = devBuySupplyShare(curve, 3);
    expect(three.tokens / 1e6).toBeCloseTo(96.66, 1);
    expect(three.share * 100).toBeCloseTo(9.67, 1);
    expect(devBuySupplyShare(curve, 5).share * 100).toBeCloseTo(15.2, 0);
  });

  it.each([
    ["virtualSol = 0", { initial_virtual_sol_reserves: 0n }],
    ["realTokens > virtualTokens", { initial_real_token_reserves: 1_074_000_000_000_000n }],
    ["totalSupply < realTokens", { token_total_supply: 793_000_000_000_000n }],
    ["fees of 10 %", { fee_basis_points: 1_000n, creator_fee_basis_points: 0n }],
    ["a value beyond 2^53", { token_total_supply: 2n ** 53n }],
  ])("rejects %s as invalid values", (_label, overrides) => {
    const raw = decodePumpGlobal(syntheticGlobalAccount(overrides));

    expect(() => pumpGlobalToCurveParams(raw)).toThrow(
      expect.objectContaining({ reason: "invalid_values" }),
    );
  });

  it("rejects the devnet Global, whose 1 SOL of virtual reserves the max dev buy completes", () => {
    const raw = decodePumpGlobal(devnetGlobalAccount());
    const asIs = { ...FALLBACK_CURVE_PARAMS, virtualSol: 1 };

    expect(devBuySupplyShare(asIs, DEV_BUY_MAX_SOL).capped).toBe(true);
    expect(devBuySupplyShare(FALLBACK_CURVE_PARAMS, DEV_BUY_MAX_SOL).capped).toBe(false);
    expect(() => pumpGlobalToCurveParams(raw)).toThrow(
      expect.objectContaining({ reason: "invalid_values" }),
    );
    expect(() => pumpGlobalToCurveParams(raw)).toThrow(/20 SOL dev buy completes the curve/);
  });
});
