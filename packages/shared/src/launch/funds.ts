import {
  BUNDLE_LAMPORT_UNIT,
  BUNDLE_MAX_LAMPORTS,
  BUNDLE_MIN_LAMPORTS,
  BUNDLE_PRESETS_SOL,
  DEV_BUY_LAMPORTS,
} from "../constants.js";
import { solToLamports } from "../format/sol.js";
import { parseBundleAmount } from "../schemas.js";
import { computeMaxAmount } from "../wallets.js";

// The money of a launch (§10.1, V1-35, V1-36, decision of 25/09/2026): the wallet pays the
// dev buy of 1 SOL and the bundle, nothing on top, fees included since they are taken from
// the bundle (decision of 26/09/2026); lamports only. The smallest launch is
// `WALLET_READY_MIN_LAMPORTS`, the rule of the home screen too (D13).
//
// Test amounts (`LAUNCH_TEST_DIVISOR`, devnet only, decision of 26/09/2026): what leaves the
// wallet is the dev buy and the bundle divided by `divisor`. The choices stay in product
// amounts (a 3 SOL bundle), the checks count what really leaves the wallet.

/** What leaves the wallet for the dev buy and a bundle of `bundle`, fees included. */
export const launchSpendLamports = (bundle: bigint, divisor = 1n): bigint =>
  (DEV_BUY_LAMPORTS + bundle) / divisor;

/** What `balance` lacks to pay the dev buy and a bundle of `bundle`: 0 when it covers both. */
export const launchShortfallLamports = (balance: bigint, bundle: bigint, divisor = 1n): bigint => {
  const missing = launchSpendLamports(bundle, divisor) - balance;
  return missing > 0n ? missing : 0n;
};

/** What the smallest launch lacks (1 SOL dev buy + 3 SOL bundle): the rule of step 1. */
export const smallestLaunchShortfall = (balance: bigint, divisor = 1n): bigint =>
  launchShortfallLamports(balance, BUNDLE_MIN_LAMPORTS, divisor);

/** A wallet that can pay the smallest launch: the home screen says so from 4 SOL (D13). */
export const isWalletReady = (balance: bigint, divisor = 1n): boolean =>
  smallestLaunchShortfall(balance, divisor) === 0n;

/**
 * The largest Custom bundle `balance` covers once the dev buy is paid, capped at 20 SOL and
 * floored to 0.001 SOL so the amount shown is always accepted; `null` under the smallest
 * bundle (`smallestLaunchShortfall` says why).
 */
export function customMaxLamports(balance: bigint, divisor = 1n): bigint | null {
  // The largest dev buy + bundle whose share `balance` pays (itself when `divisor` is 1).
  const reach = balance * divisor + divisor - 1n;
  // What is left for the bundle once the dev buy is paid, never below 0.
  const left = computeMaxAmount(reach, DEV_BUY_LAMPORTS);
  const capped = left < BUNDLE_MAX_LAMPORTS ? left : BUNDLE_MAX_LAMPORTS;
  const max = (capped / BUNDLE_LAMPORT_UNIT) * BUNDLE_LAMPORT_UNIT;
  return max >= BUNDLE_MIN_LAMPORTS ? max : null;
}

export type BundleStatuses = {
  /** 3, 5 and 10 SOL, with what the wallet lacks for each (0: covered). */
  presets: { lamports: bigint; shortfall: bigint }[];
  customMaxLamports: bigint | null;
};

/** The lines of step 2 (§10.1), always shown, whatever was clicked. */
export function bundleStatuses(balance: bigint, divisor = 1n): BundleStatuses {
  return {
    presets: BUNDLE_PRESETS_SOL.map((sol) => {
      const lamports = solToLamports(sol);
      return { lamports, shortfall: launchShortfallLamports(balance, lamports, divisor) };
    }),
    customMaxLamports: customMaxLamports(balance, divisor),
  };
}

/** A preset of the keyboard (`lc:b:<sol>`), or `null` for anything else. */
export function bundlePresetLamports(arg: string | undefined): bigint | null {
  const preset = BUNDLE_PRESETS_SOL.find((sol) => String(sol) === arg);
  return preset === undefined ? null : solToLamports(preset);
}

export type LaunchBundleInput =
  | { ok: true; lamports: bigint }
  /** Not a number from 3 to 20 SOL with 3 decimals at most: the flag of the simulation. */
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "insufficient"; lamports: bigint; shortfall: bigint };

/**
 * The Custom bundle of step 2 (§7.3: the same bounds in a simulation as in a launch): the
 * parser of the simulation, then the balance of the wallet.
 */
export function parseLaunchBundleInput(
  text: string,
  balance: bigint,
  divisor = 1n,
): LaunchBundleInput {
  const parsed = parseBundleAmount(text);
  if (!parsed.ok) return { ok: false, reason: "invalid" };
  const { lamports } = parsed;
  const shortfall = launchShortfallLamports(balance, lamports, divisor);
  return shortfall === 0n
    ? { ok: true, lamports }
    : { ok: false, reason: "insufficient", lamports, shortfall };
}
