import { DEV_BUY_MAX_SOL, LAMPORTS_PER_SOL } from "@launchbot/shared";
import { assertCurveParams, devBuySupplyShare, TOKEN_DECIMALS } from "@launchbot/sim-engine";
import type { CurveParams } from "@launchbot/sim-engine";
import type { Global as PumpGlobal } from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "./constants.js";
import { pumpSdk } from "./sdk.js";

/**
 * Why a read of the `Global` account gave no usable curve. Each one makes `getCurveParams`
 * fall back (V1-21), with the reason in a `warn` log.
 */
export type PumpGlobalFailure =
  | "account_not_found"
  | "wrong_owner"
  | "bad_discriminator"
  | "decode_error"
  | "invalid_values"
  | "rpc_error"
  | "timeout";

export class PumpGlobalError extends Error {
  readonly reason: PumpGlobalFailure;

  constructor(reason: PumpGlobalFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PumpGlobalError";
    this.reason = reason;
  }
}

/** What `getAccountInfo` gives of an account, reduced to what the decoder checks. */
export type PumpAccount = { owner: string; data: Uint8Array };

/** The fields of `Global` the simulation uses, in on-chain units (lamports, base units, bps). */
export type PumpGlobalRaw = {
  initialVirtualSolReserves: bigint;
  initialVirtualTokenReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
};

// The layout comes from the IDL the SDK vendors (pump-fun/pump-public-docs, `pump.json`),
// never from offsets written here. The IDL is a JSON literal in the SDK: read structurally.
type IdlField = { name: string; type: unknown };
type Idl = {
  accounts: { name: string; discriminator: number[] }[];
  types: { name: string; type: { fields?: IdlField[] } }[];
};
const idl = pumpSdk.pumpIdl as unknown as Idl;

const globalAccount = idl.accounts.find((account) => account.name === "Global");
const globalFields = idl.types.find((type) => type.name === "Global")?.type.fields;
if (globalAccount === undefined || globalFields === undefined) {
  throw new Error("The pump IDL of the SDK has no Global account");
}

/** Anchor writes the account name's hash in the first 8 bytes. */
export const GLOBAL_DISCRIMINATOR: Readonly<Uint8Array> = Uint8Array.from(
  globalAccount.discriminator,
);
const DISCRIMINATOR_SIZE = GLOBAL_DISCRIMINATOR.length;

const BORSH_SIZES: Readonly<Record<string, number>> = { bool: 1, u8: 1, u64: 8, pubkey: 32 };

function borshSize(type: unknown): number {
  if (typeof type === "string" && BORSH_SIZES[type] !== undefined) return BORSH_SIZES[type];
  if (typeof type === "object" && type !== null && "array" in type && Array.isArray(type.array)) {
    const [item, length] = type.array as [unknown, unknown];
    return borshSize(item) * Number(length);
  }
  throw new Error(`Unsupported IDL type in Global: ${JSON.stringify(type)}`);
}

const LAST_FIELD_USED = "creator_fee_basis_points";
const lastFieldIndex = globalFields.findIndex((field) => field.name === LAST_FIELD_USED);
if (lastFieldIndex < 0) throw new Error(`The pump IDL Global has no ${LAST_FIELD_USED}`);

/**
 * The bytes the fields used here occupy, discriminator included: 162. The SDK zero-pads a
 * shorter account up to the full layout, which would read missing fields as 0 in silence;
 * longer accounts are fine, the IDL only ever appends fields (`GLOBAL_SIZE` is 1087 while
 * the live account has 1054 bytes).
 */
export const GLOBAL_MIN_SIZE =
  DISCRIMINATOR_SIZE +
  globalFields
    .slice(0, lastFieldIndex + 1)
    .reduce((size, field) => size + borshSize(field.type), 0);

const toBigInt = (value: { toString(): string }): bigint => BigInt(value.toString());

/**
 * `Global` as read from the chain, checked then decoded by the SDK. Throws a
 * `PumpGlobalError` with the failed check as `reason`.
 */
export function decodePumpGlobal(account: PumpAccount | null): PumpGlobalRaw {
  if (account === null) {
    throw new PumpGlobalError("account_not_found", "No account at the pump.fun Global address");
  }
  if (account.owner !== PUMP_PROGRAM_ID) {
    throw new PumpGlobalError("wrong_owner", `The Global account is owned by ${account.owner}`);
  }
  const data = Buffer.from(account.data.buffer, account.data.byteOffset, account.data.byteLength);
  if (!data.subarray(0, DISCRIMINATOR_SIZE).equals(GLOBAL_DISCRIMINATOR)) {
    throw new PumpGlobalError("bad_discriminator", "The account is not a pump.fun Global");
  }
  if (data.length < GLOBAL_MIN_SIZE) {
    throw new PumpGlobalError(
      "decode_error",
      `The Global account has ${data.length} bytes, ${GLOBAL_MIN_SIZE} at least expected`,
    );
  }

  let global: PumpGlobal;
  try {
    global = pumpSdk.PUMP_SDK.decodeGlobal({
      data,
      owner: new PublicKey(account.owner),
      executable: false,
      lamports: 0,
    });
  } catch (error) {
    throw new PumpGlobalError("decode_error", "The Global account does not decode", {
      cause: error,
    });
  }

  return {
    initialVirtualSolReserves: toBigInt(global.initialVirtualSolReserves),
    initialVirtualTokenReserves: toBigInt(global.initialVirtualTokenReserves),
    initialRealTokenReserves: toBigInt(global.initialRealTokenReserves),
    tokenTotalSupply: toBigInt(global.tokenTotalSupply),
    feeBasisPoints: toBigInt(global.feeBasisPoints),
    creatorFeeBasisPoints: toBigInt(global.creatorFeeBasisPoints),
  };
}

const BASIS_POINTS = 10_000;
const TOKEN_UNIT = 10 ** TOKEN_DECIMALS;
/** Proposal: a Global that announced 10 % of fees or more is treated as corrupt. */
const MAX_FEE_RATE = 0.1;

function toSafeNumber(value: bigint, field: string): number {
  // Every value is at most 1.073e15 < 2^53: a bigger one is not a curve parameter.
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PumpGlobalError("invalid_values", `${field} does not fit a safe integer`);
  }
  return Number(value);
}

function invalid(message: string, cause?: unknown): PumpGlobalError {
  return new PumpGlobalError(
    "invalid_values",
    message,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * The `Global` fields in the units of the engine (§7.1, §7.4): SOL, tokens, a rate.
 *
 * Fees: what the trader pays is the protocol fee plus the creator fee, `fee_basis_points +
 * creator_fee_basis_points` (95 + 5 bps on devnet, the 1 % of §7.1). Proposal, to confirm
 * in V2-01 against real trades. pump.fun also has fees by market cap tier (pump-fees
 * program, `FeeConfig` account): not modelled in V1, see the README of this package.
 *
 * Validation: `assertCurveParams` of the engine, a fee rate below 10 %, and (proposal) a
 * curve the largest dev buy of the product does not complete at t = 0. The devnet Global
 * holds 1 SOL of virtual reserves where mainnet holds 30: a 3 SOL dev buy would end every
 * simulation before its first trade. Such a Global is a test configuration, not the curve
 * the simulation models, and the §7.1 values stand in.
 */
export function pumpGlobalToCurveParams(raw: PumpGlobalRaw): CurveParams {
  const params: CurveParams = {
    virtualSol:
      toSafeNumber(raw.initialVirtualSolReserves, "initial_virtual_sol_reserves") /
      Number(LAMPORTS_PER_SOL),
    virtualTokens:
      toSafeNumber(raw.initialVirtualTokenReserves, "initial_virtual_token_reserves") / TOKEN_UNIT,
    realTokens:
      toSafeNumber(raw.initialRealTokenReserves, "initial_real_token_reserves") / TOKEN_UNIT,
    totalSupply: toSafeNumber(raw.tokenTotalSupply, "token_total_supply") / TOKEN_UNIT,
    feeRate:
      toSafeNumber(raw.feeBasisPoints + raw.creatorFeeBasisPoints, "fee_basis_points") /
      BASIS_POINTS,
  };

  try {
    assertCurveParams(params);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "Invalid curve params", error);
  }
  if (params.feeRate >= MAX_FEE_RATE) {
    throw invalid(`feeRate ${params.feeRate} is ${MAX_FEE_RATE * 100} % or more`);
  }
  if (devBuySupplyShare(params, DEV_BUY_MAX_SOL).capped) {
    throw invalid(
      `a ${DEV_BUY_MAX_SOL} SOL dev buy completes the curve at t = 0 (virtualSol ${params.virtualSol})`,
    );
  }
  return params;
}
