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
// dev buy of 1 SOL and the bundle, nothing on top; lamports only. The smallest launch is
// `WALLET_READY_MIN_LAMPORTS`, the rule of the home screen too (D13).

/** What `balance` lacks to pay the dev buy and a bundle of `bundle`: 0 when it covers both. */
export const launchShortfallLamports = (balance: bigint, bundle: bigint): bigint => {
  const missing = DEV_BUY_LAMPORTS + bundle - balance;
  return missing > 0n ? missing : 0n;
};

/** What the smallest launch lacks (1 SOL dev buy + 3 SOL bundle): the rule of step 1. */
export const smallestLaunchShortfall = (balance: bigint): bigint =>
  launchShortfallLamports(balance, BUNDLE_MIN_LAMPORTS);

/**
 * The largest Custom bundle `balance` covers once the dev buy is paid, capped at 20 SOL and
 * floored to 0.001 SOL so the amount shown is always accepted; `null` under the smallest
 * bundle (`smallestLaunchShortfall` says why).
 */
export function customMaxLamports(balance: bigint): bigint | null {
  // What is left for the bundle once the dev buy is paid, never below 0.
  const left = computeMaxAmount(balance, DEV_BUY_LAMPORTS);
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
export function bundleStatuses(balance: bigint): BundleStatuses {
  return {
    presets: BUNDLE_PRESETS_SOL.map((sol) => {
      const lamports = solToLamports(sol);
      return { lamports, shortfall: launchShortfallLamports(balance, lamports) };
    }),
    customMaxLamports: customMaxLamports(balance),
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
export function parseLaunchBundleInput(text: string, balance: bigint): LaunchBundleInput {
  const parsed = parseBundleAmount(text);
  if (!parsed.ok) return { ok: false, reason: "invalid" };
  const { lamports } = parsed;
  const shortfall = launchShortfallLamports(balance, lamports);
  return shortfall === 0n
    ? { ok: true, lamports }
    : { ok: false, reason: "insufficient", lamports, shortfall };
}
