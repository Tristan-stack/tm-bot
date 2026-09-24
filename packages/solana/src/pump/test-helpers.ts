import { readFileSync } from "node:fs";
import { PUMP_PROGRAM_ID } from "./constants.js";
import { globalFieldOffset } from "./global.js";
import type { PumpAccount } from "./global.js";

/** The devnet Global account, captured with its date in the fixture (V1-21). */
export const DEVNET_FIXTURE = JSON.parse(
  readFileSync(new URL("../../test/fixtures/pump-global-devnet.json", import.meta.url), "utf8"),
) as {
  address: string;
  capturedAt: string;
  slot: number;
  owner: string;
  lamports: number;
  space: number;
  data: [string, "base64"];
};

export function devnetGlobalAccount(): PumpAccount {
  return { owner: DEVNET_FIXTURE.owner, data: Buffer.from(DEVNET_FIXTURE.data[0], "base64") };
}

export type GlobalOverrides = Partial<
  Record<
    | "initial_virtual_sol_reserves"
    | "initial_virtual_token_reserves"
    | "initial_real_token_reserves"
    | "token_total_supply"
    | "fee_basis_points"
    | "creator_fee_basis_points",
    bigint
  >
>;

/** The devnet account with some u64 fields rewritten: the §7.1 values by default. */
export function syntheticGlobalAccount(overrides: GlobalOverrides = {}): PumpAccount {
  const values: Required<GlobalOverrides> = {
    initial_virtual_sol_reserves: 30_000_000_000n,
    initial_virtual_token_reserves: 1_073_000_000_000_000n,
    initial_real_token_reserves: 793_100_000_000_000n,
    token_total_supply: 1_000_000_000_000_000n,
    fee_basis_points: 95n,
    creator_fee_basis_points: 5n,
    ...overrides,
  };
  const data = Buffer.from(DEVNET_FIXTURE.data[0], "base64");
  for (const [field, value] of Object.entries(values)) {
    data.writeBigUInt64LE(value, globalFieldOffset(field));
  }
  return { owner: PUMP_PROGRAM_ID, data };
}
