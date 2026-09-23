import { describe, expect, it } from "vitest";
import { HOUR_MS, LAMPORTS_PER_SOL as SOL, MINUTE_MS } from "../constants.js";
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatInt,
  formatPct,
  formatRemaining,
  formatSol,
  formatSolAmount,
  formatSolExact,
  formatSolPrice,
  formatTimeUtc,
  formatTokenAmount,
  formatUsd,
  parseSolToLamports,
  shortAddress,
  usdOf,
  utf8ByteLength,
  withUsd,
} from "./index.js";

describe("formatSol", () => {
  it("shows 3 decimals by default", () => {
    expect(formatSol(2_500_000_000n)).toBe("2.500 SOL");
    expect(formatSol(0n)).toBe("0.000 SOL");
    expect(formatSol(1_234_567_000_000n)).toBe("1234.567 SOL");
  });

  it("never overstates a balance: floor by default", () => {
    expect(formatSol(2_499_999_999n)).toBe("2.499 SOL");
    expect(formatSol(999_999n)).toBe("0.000 SOL");
  });

  it("rounds a missing amount up", () => {
    expect(formatSol(650_000_000n, { rounding: "ceil" })).toBe("0.650 SOL");
    expect(formatSol(649_000_001n, { rounding: "ceil" })).toBe("0.650 SOL");
    expect(formatSol(1n, { rounding: "ceil" })).toBe("0.001 SOL");
  });

  it("formats an invoice amount with 4 decimals", () => {
    expect(formatSol(570_800_000n, { decimals: 4 })).toBe("0.5708 SOL");
    expect(formatSol(570_820_431n, { decimals: 4, rounding: "ceil" })).toBe("0.5709 SOL");
    expect(formatSol(570_820_431n, { decimals: 4, rounding: "floor" })).toBe("0.5708 SOL");
  });

  it("rounds half up on request", () => {
    expect(formatSol(1_000_500_000n, { rounding: "halfUp" })).toBe("1.001 SOL");
    expect(formatSol(1_000_499_999n, { rounding: "halfUp" })).toBe("1.000 SOL");
    expect(formatSol(999_999_999n, { rounding: "halfUp" })).toBe("1.000 SOL");
  });

  it("trims trailing zeros", () => {
    expect(formatSol(3n * SOL, { trim: true })).toBe("3 SOL");
    expect(formatSol(50_000_000n, { trim: true })).toBe("0.05 SOL");
    expect(formatSol(10n * SOL, { trim: true })).toBe("10 SOL");
    expect(formatSol(0n, { trim: true })).toBe("0 SOL");
  });

  it("handles 0 and 9 decimals, and negative amounts", () => {
    expect(formatSol(2_900_000_000n, { decimals: 0 })).toBe("2 SOL");
    expect(formatSolAmount(5_000_000_001n, { decimals: 9 })).toBe("5.000000001");
    expect(formatSolAmount(5n * SOL, { decimals: 9, trim: true })).toBe("5");
    expect(formatSol(-1_234_500_000n)).toBe("-1.234 SOL");
    expect(formatSol(-1n)).toBe("0.000 SOL");
  });

  it("rejects an invalid number of decimals", () => {
    expect(() => formatSol(1n, { decimals: 10 })).toThrow(RangeError);
    expect(() => formatSol(1n, { decimals: 1.5 })).toThrow(RangeError);
  });
});

describe("formatSolExact", () => {
  it("keeps every decimal that is not zero, and three at least", () => {
    expect(formatSolExact(1_250_000_000n)).toBe("1.250 SOL");
    expect(formatSolExact(5_000n)).toBe("0.000005 SOL");
    expect(formatSolExact(2_499_995_000n)).toBe("2.499995 SOL");
    expect(formatSolExact(1n)).toBe("0.000000001 SOL");
    expect(formatSolExact(0n)).toBe("0.000 SOL");
    expect(formatSolExact(3n * SOL)).toBe("3.000 SOL");
  });
});

describe("parseSolToLamports", () => {
  it("accepts a dot or a comma, up to 9 decimals", () => {
    expect(parseSolToLamports("5")).toBe(5n * SOL);
    expect(parseSolToLamports("2.5")).toBe(2_500_000_000n);
    expect(parseSolToLamports("2,5")).toBe(2_500_000_000n);
    expect(parseSolToLamports(" 0.000000001 ")).toBe(1n);
    expect(parseSolToLamports("0.1")).toBe(100_000_000n);
    expect(parseSolToLamports("0")).toBe(0n);
  });

  it("accepts the unit after the number", () => {
    expect(parseSolToLamports("1 SOL")).toBe(SOL);
    expect(parseSolToLamports("0,5sol")).toBe(500_000_000n);
    expect(parseSolToLamports(" 0.000000001 SOL ")).toBe(1n);
  });

  it.each([
    "",
    "abc",
    "-1",
    "+1",
    "1e3",
    "1.0000000001",
    "1.",
    ".5",
    "1.2.3",
    "1 000",
    "0x10",
    "SOL",
    "1 SOL SOL",
    "1 sol 2",
  ])("rejects %j", (input) => {
    expect(parseSolToLamports(input)).toBeNull();
  });
});

describe("USD", () => {
  it("formats dollars with grouping and 2 decimals", () => {
    expect(formatUsd(1234.56)).toBe("$1,234.56");
    expect(formatUsd(59)).toBe("$59.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1_000_000)).toBe("$1,000,000.00");
    expect(formatUsd(-12.5)).toBe("-$12.50");
    expect(formatUsd(-0.001)).toBe("$0.00");
  });

  it.each([
    [2_500_000_000n, "2.500 SOL ($258.40)"],
    [1_750_000_000n, "1.750 SOL ($180.88)"],
    [4_250_000_000n, "4.250 SOL ($439.28)"],
    [4_200_000_000n, "4.200 SOL ($434.11)"],
  ])("values %d lamports at $103.36", (lamports, expected) => {
    expect(withUsd(formatSol(lamports), usdOf(lamports, 103.36))).toBe(expected);
  });

  it("hides USD amounts when the SOL price is unknown", () => {
    expect(usdOf(2_500_000_000n, null)).toBeNull();
    expect(withUsd("2.500 SOL", null)).toBe("2.500 SOL");
    expect(formatSolPrice(null)).toBe("SOL —");
    expect(formatSolPrice(103.36)).toBe("SOL $103.36");
  });
});

describe("shortAddress", () => {
  it("keeps the head and the tail around an ellipsis", () => {
    expect(shortAddress("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("7xKX…gAsU");
    expect(shortAddress("OTTRk3abcdefghijklmnopqrstuvwxyz9fQ2", 6, 4)).toBe("OTTRk3…9fQ2");
    expect(shortAddress("short")).toBe("short");
  });
});

describe("dates (UTC)", () => {
  const date = new Date("2026-09-17T14:32:00Z");

  it("formats dates and times in UTC", () => {
    expect(formatDateTime(date)).toBe("17 Sep 2026, 14:32 UTC");
    expect(formatDate(new Date("2026-09-12T23:59:59Z"))).toBe("12 Sep 2026");
    expect(formatTimeUtc(date)).toBe("14:32 UTC");
    expect(formatDayMonth(new Date("2026-10-12T00:00:00Z"))).toBe("12 Oct");
  });

  it("writes the day without a leading zero and the hours on 2 digits", () => {
    expect(formatDateTime(new Date("2026-01-05T04:07:00Z"))).toBe("5 Jan 2026, 04:07 UTC");
  });

  it("does not depend on the local timezone", () => {
    expect(formatDate(new Date("2026-12-31T23:30:00-05:00"))).toBe("1 Jan 2027");
  });
});

describe("formatRemaining", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const inMs = (ms: number) => new Date(now.getTime() + ms);

  it("shows the end date from 72 h", () => {
    expect(formatRemaining(inMs(72 * HOUR_MS), now)).toBe("until 12 Oct");
    expect(formatRemaining(inMs(30 * 24 * HOUR_MS), now)).toBe("until 8 Nov");
  });

  it("shows the time left under 72 h, rounded down", () => {
    expect(formatRemaining(inMs(71 * HOUR_MS + 59 * MINUTE_MS), now)).toBe("2d 23h left");
    expect(formatRemaining(inMs(28 * HOUR_MS + 30 * MINUTE_MS), now)).toBe("1d 4h left");
    expect(formatRemaining(inMs(4 * HOUR_MS + 59 * MINUTE_MS), now)).toBe("4h left");
    expect(formatRemaining(inMs(35 * MINUTE_MS + 59_000), now)).toBe("35m left");
    expect(formatRemaining(inMs(20_000), now)).toBe("1m left");
  });

  it("returns null once expired", () => {
    expect(formatRemaining(now, now)).toBeNull();
    expect(formatRemaining(inMs(-1), now)).toBeNull();
  });
});

describe("numbers", () => {
  it("formats a clock in m:ss, rounded down", () => {
    expect(formatClock(92)).toBe("1:32");
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(1800)).toBe("30:00");
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("abbreviates token amounts", () => {
    expect(formatTokenAmount(96_660_000)).toBe("96.66M");
    expect(formatTokenAmount(1_000_000_000)).toBe("1.00B");
    expect(formatTokenAmount(12_340)).toBe("12.34K");
    expect(formatTokenAmount(999_999)).toBe("1.00M");
    expect(formatTokenAmount(999.999)).toBe("1.00K");
    expect(formatTokenAmount(950)).toBe("950");
    expect(formatTokenAmount(12.5)).toBe("12.5");
    expect(formatTokenAmount(0)).toBe("0");
  });

  it("formats percentages", () => {
    expect(formatPct(0.0967)).toBe("9.67%");
    expect(formatPct(0.152, 1)).toBe("15.2%");
    expect(formatPct(0.62, 0)).toBe("62%");
  });

  it("groups integers", () => {
    expect(formatInt(1248)).toBe("1,248");
    expect(formatInt(767)).toBe("767");
    expect(formatInt(1_234_567n)).toBe("1,234,567");
    expect(formatInt(-1500)).toBe("-1,500");
  });

  it("counts UTF-8 bytes", () => {
    expect(utf8ByteLength("🚀")).toBe(4);
    expect(utf8ByteLength("Moon Otter")).toBe(10);
    expect(utf8ByteLength("é")).toBe(2);
  });
});
