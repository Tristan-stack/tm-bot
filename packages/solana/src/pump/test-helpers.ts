import { readFileSync } from "node:fs";
import { PUMP_PROGRAM_ID } from "./constants.js";
import type { PumpAccount } from "./global.js";
import { pumpSdk } from "./sdk.js";

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

// Offsets come from the IDL of the SDK, walked field by field: the tests write no offset.
type IdlField = { name: string; type: unknown };
const SIZES: Readonly<Record<string, number>> = { bool: 1, u8: 1, u64: 8, pubkey: 32 };
const sizeOf = (type: unknown): number => {
  if (typeof type === "string") return SIZES[type] ?? Number.NaN;
  const array = (type as { array?: [unknown, number] }).array;
  return array === undefined ? Number.NaN : sizeOf(array[0]) * array[1];
};

function offsetOf(field: string): number {
  const { types } = pumpSdk.pumpIdl as unknown as {
    types: { name: string; type: { fields?: IdlField[] } }[];
  };
  const fields = types.find((type) => type.name === "Global")?.type.fields ?? [];
  let offset = 8;
  for (const candidate of fields) {
    if (candidate.name === field) return offset;
    offset += sizeOf(candidate.type);
  }
  throw new Error(`No field ${field} in Global`);
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
    data.writeBigUInt64LE(value, offsetOf(field));
  }
  return { owner: PUMP_PROGRAM_ID, data };
}
