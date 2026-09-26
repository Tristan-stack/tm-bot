import { describe, expect, it } from "vitest";
import { WALLET_READY_MIN_LAMPORTS } from "../constants.js";
import { solToLamports as sol } from "../format/sol.js";
import {
  bundlePresetLamports,
  bundleStatuses,
  customMaxLamports,
  isWalletReady,
  launchShortfallLamports,
  launchSpendLamports,
  parseLaunchBundleInput,
  smallestLaunchShortfall,
} from "./funds.js";

describe("test amounts (LAUNCH_TEST_DIVISOR, decision of 26/09/2026)", () => {
  it("divides what leaves the wallet, fees included, and nothing else", () => {
    expect(launchSpendLamports(sol(3))).toBe(sol(4));
    expect(launchSpendLamports(sol(3), 100n)).toBe(sol(0.04));
    expect(launchSpendLamports(sol(20), 1_000n)).toBe(sol(0.021));
  });

  it("checks a balance against the divided amounts, and says what it lacks in real SOL", () => {
    expect(launchShortfallLamports(sol(0.04), sol(3), 100n)).toBe(0n);
    expect(launchShortfallLamports(sol(0.042), sol(5), 100n)).toBe(sol(0.018));
    expect(smallestLaunchShortfall(sol(0.4), 100n)).toBe(0n);
    expect(isWalletReady(sol(0.04), 100n)).toBe(true);
    expect(isWalletReady(sol(0.039), 100n)).toBe(false);
  });

  it("keeps the choices in product amounts: Custom up to what the divided balance pays", () => {
    // 0.042 SOL pays 4.2 SOL of dev buy and bundle once divided by 100: a 3.200 SOL bundle.
    expect(customMaxLamports(sol(0.042), 100n)).toBe(sol(3.2));
    expect(bundleStatuses(sol(0.042), 100n).presets[1]).toEqual({
      lamports: sol(5),
      shortfall: sol(0.018),
    });
    expect(parseLaunchBundleInput("3.2", sol(0.042), 100n)).toEqual({
      ok: true,
      lamports: sol(3.2),
    });
  });
});

describe("launchShortfallLamports (V1-35, decision of 25/09/2026)", () => {
  it("counts the 1 SOL dev buy plus the bundle, nothing on top, never below 0", () => {
    expect(launchShortfallLamports(sol(4.2), sol(3))).toBe(0n);
    expect(launchShortfallLamports(sol(4), sol(3))).toBe(0n);
    expect(launchShortfallLamports(sol(4.2), sol(5))).toBe(sol(1.8));
    expect(launchShortfallLamports(sol(30), sol(20))).toBe(0n);
  });

  it("asks 4 SOL for the smallest launch, the rule of the home screen (D13)", () => {
    expect(WALLET_READY_MIN_LAMPORTS).toBe(sol(4));
    expect(smallestLaunchShortfall(sol(4))).toBe(0n);
    expect(smallestLaunchShortfall(3_999_999_999n)).toBe(1n);
    expect(smallestLaunchShortfall(sol(0.4))).toBe(sol(3.6));
    expect(isWalletReady(WALLET_READY_MIN_LAMPORTS)).toBe(true);
    expect(isWalletReady(WALLET_READY_MIN_LAMPORTS - 1n)).toBe(false);
  });
});

describe("bundleStatuses (V1-36)", () => {
  it("4.200 SOL: a 3 SOL bundle covered, 5 and 10 short, Custom up to 3.200", () => {
    const statuses = bundleStatuses(sol(4.2));

    expect(statuses.presets).toEqual([
      { lamports: sol(3), shortfall: 0n },
      { lamports: sol(5), shortfall: sol(1.8) },
      { lamports: sol(10), shortfall: sol(6.8) },
    ]);
    expect(statuses.customMaxLamports).toBe(sol(3.2));
  });

  it("caps Custom at 20 SOL once the dev buy is paid, and floors it to the thousandth", () => {
    expect(customMaxLamports(sol(30))).toBe(sol(20));
    expect(customMaxLamports(sol(21))).toBe(sol(20));
    expect(customMaxLamports(sol(4))).toBe(sol(3));
    expect(bundleStatuses(sol(4)).presets[1]?.shortfall).toBe(sol(2));

    const odd = bundleStatuses(4_199_999_500n);
    expect(odd.customMaxLamports).toBe(sol(3.199));
    expect(odd.presets[1]?.shortfall).toBe(1_800_000_500n);
  });

  it("has no Custom under the smallest bundle", () => {
    expect(customMaxLamports(3_999_999_999n)).toBeNull();
    expect(customMaxLamports(sol(0.9))).toBeNull();
    expect(customMaxLamports(0n)).toBeNull();
  });
});

describe("bundlePresetLamports", () => {
  it("accepts the presets of the keyboard only", () => {
    expect(bundlePresetLamports("5")).toBe(sol(5));
    expect(bundlePresetLamports("4")).toBeNull();
    expect(bundlePresetLamports(undefined)).toBeNull();
  });
});

describe("parseLaunchBundleInput (V1-36)", () => {
  it.each([
    ["3", sol(3)],
    ["3.5", sol(3.5)],
    ["3,5", sol(3.5)],
    ["3.5 SOL", sol(3.5)],
    ["20", sol(20)],
    ["4.125", 4_125_000_000n],
  ])("accepts %s as exact lamports", (text, lamports) => {
    expect(parseLaunchBundleInput(text, sol(30))).toEqual({ ok: true, lamports });
  });

  it.each(["2.999", "1", "20.001", "21", "abc", "", "-3", "1e1", "3.1234"])(
    "refuses %s as invalid",
    (text) => {
      expect(parseLaunchBundleInput(text, sol(30))).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("says what a valid bundle lacks with this wallet", () => {
    expect(parseLaunchBundleInput("7", sol(4.2))).toEqual({
      ok: false,
      reason: "insufficient",
      lamports: sol(7),
      shortfall: 3_800_000_000n,
    });
  });
});
