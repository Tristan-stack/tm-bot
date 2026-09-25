import { describe, expect, it } from "vitest";
import { formatSol, parseSolToLamports } from "../format/sol.js";
import { computeExpectedLamports, formatSolUsdRate } from "./amounts.js";

describe("computeExpectedLamports (§8.3: rounded up to the lamport)", () => {
  it.each([
    [5_900, "103.36", 570_820_434n],
    [4_900, "150", 326_666_667n],
    [17_900, "250.5", 714_570_859n],
    [5_900, "103.36000000", 570_820_434n],
  ])("$%i cents at %s → %i lamports", (cents, rate, lamports) => {
    expect(computeExpectedLamports(cents, rate)).toBe(lamports);
  });

  it("is exact when the division falls on a lamport", () => {
    // $50 at $100: 0.5 SOL.
    expect(computeExpectedLamports(5_000, "100")).toBe(500_000_000n);
  });

  it("is the smallest lamport count worth the USD price at the rate", () => {
    const rates: [string, bigint][] = [
      ["97.12345678", 9_712_345_678n],
      ["103.36", 10_336_000_000n],
      ["212.5", 21_250_000_000n],
      ["1.00000001", 100_000_001n],
      ["999.99999999", 99_999_999_999n],
    ];
    for (const [rate, rateE8] of rates) {
      for (const cents of [4_900, 5_900, 16_900, 17_900]) {
        const lamports = computeExpectedLamports(cents, rate);
        // lamports × rate covers the price, one lamport less would be short.
        const price = BigInt(cents) * 10n ** 15n;
        expect(lamports * rateE8 >= price).toBe(true);
        expect((lamports - 1n) * rateE8 < price).toBe(true);
      }
    }
  });

  it.each(["0", "0.00000000", "-1", "abc", "1.123456789", "1e3", ""])(
    "refuses the rate %j",
    (rate) => {
      expect(() => computeExpectedLamports(5_900, rate)).toThrow(RangeError);
    },
  );
});

describe("formatSolUsdRate", () => {
  it("keeps 8 decimals, like the column of the invoice", () => {
    expect(formatSolUsdRate(103.36)).toBe("103.36000000");
    expect(formatSolUsdRate(150.123456789)).toBe("150.12345679");
  });
});

describe("the amount a screen shows (DEC-06)", () => {
  const shown = (lamports: bigint) => formatSol(lamports, { decimals: 4, rounding: "ceil" });

  it("rounds up to 0.0001 SOL, so the amount shown is never short", () => {
    expect(shown(570_820_434n)).toBe("0.5709 SOL");
    const sent = parseSolToLamports(shown(570_820_434n));
    expect(sent !== null && sent >= 570_820_434n && sent < 570_820_434n + 100_000n).toBe(true);
  });

  it("keeps an amount already at 4 decimals", () => {
    expect(shown(570_800_000n)).toBe("0.5708 SOL");
  });
});
