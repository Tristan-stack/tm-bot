import { describe, expect, it } from "vitest";
import {
  callbackDataSchema,
  durationSchema,
  httpsUrlSchema,
  idSchema,
  planSchema,
  solAmountInputSchema,
  telegramIdSchema,
} from "./schemas.js";

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("schemas", () => {
  it("validates Telegram ids", () => {
    expect(accepts(telegramIdSchema, 123456789)).toBe(true);
    expect(accepts(telegramIdSchema, Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const value of [0, -5, 1.5, 2 ** 53, "123", Number.NaN]) {
      expect(accepts(telegramIdSchema, value)).toBe(false);
    }
  });

  it("validates cuid ids, plans and durations", () => {
    expect(accepts(idSchema, "cjld2cjxh0000qzrmn831i7rn")).toBe(true);
    expect(accepts(idSchema, "not an id")).toBe(false);
    expect(accepts(idSchema, "")).toBe(false);
    expect(planSchema.parse("PREMIUM")).toBe("PREMIUM");
    expect(accepts(planSchema, "premium")).toBe(false);
    expect(durationSchema.parse("TWO_DAYS")).toBe("TWO_DAYS");
    expect(accepts(durationSchema, "ONE_YEAR")).toBe(false);
  });

  it("turns a typed SOL amount into lamports", () => {
    expect(solAmountInputSchema.parse("0,5")).toBe(500_000_000n);
    expect(solAmountInputSchema.parse(2.5)).toBe(2_500_000_000n);
    for (const value of ["0", "-1", "abc", "1.0000000001", 1e-7, null]) {
      expect(accepts(solAmountInputSchema, value)).toBe(false);
    }
  });

  it("accepts https URLs only", () => {
    expect(accepts(httpsUrlSchema, "https://moonotter.xyz/path?q=1")).toBe(true);
    for (const value of [
      "http://moonotter.xyz",
      "ftp://x.y",
      "moonotter.xyz",
      "javascript:alert(1)",
    ]) {
      expect(accepts(httpsUrlSchema, value)).toBe(false);
    }
  });

  it("limits callback data to 1–64 bytes", () => {
    expect(accepts(callbackDataSchema, "nav:home")).toBe(true);
    expect(accepts(callbackDataSchema, "a".repeat(64))).toBe(true);
    expect(accepts(callbackDataSchema, "a".repeat(65))).toBe(false);
    expect(accepts(callbackDataSchema, "🚀".repeat(16))).toBe(true);
    expect(accepts(callbackDataSchema, "🚀".repeat(17))).toBe(false);
    expect(accepts(callbackDataSchema, "")).toBe(false);
  });
});
