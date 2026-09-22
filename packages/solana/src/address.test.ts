import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { isOnCurve, isValidSolanaAddress, solanaAddressSchema } from "./address.js";

const address = () => Keypair.generate().publicKey.toBase58();
/** The Global account of pump.fun: a PDA, off the curve. */
const PUMP_FUN_GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";

describe("isValidSolanaAddress", () => {
  it.each([
    ["a fresh keypair", address()],
    ["the system program (32 characters)", "11111111111111111111111111111111"],
    ["the token program", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
  ])("accepts %s", (_label, value) => {
    expect(isValidSolanaAddress(value)).toBe(true);
  });

  it.each([
    ["an empty text", ""],
    ["a space around", ` ${address()}`],
    ["a space inside", `${address().slice(0, 20)} ${address().slice(20)}`],
    ["the characters 0 O I l", `0OIl${address().slice(4)}`],
    ["31 bytes", "1".repeat(31)],
    ["33 bytes", "1".repeat(33)],
    ["a 64-byte secret key", "1".repeat(64)],
  ])("refuses %s", (_label, value) => {
    expect(isValidSolanaAddress(value)).toBe(false);
  });
});

describe("solanaAddressSchema", () => {
  it("trims the input, then requires a valid address", () => {
    const value = address();

    expect(solanaAddressSchema.parse(`  ${value}\n`)).toBe(value);
    expect(solanaAddressSchema.safeParse("not an address").success).toBe(false);
  });
});

describe("isOnCurve", () => {
  it("is true for the address of a keypair", () => {
    expect(isOnCurve(address())).toBe(true);
  });

  it("is false for a program-derived address", () => {
    // The vector is a PDA, confirmed here rather than assumed.
    expect(PublicKey.isOnCurve(new PublicKey(PUMP_FUN_GLOBAL).toBytes())).toBe(false);
    expect(isOnCurve(PUMP_FUN_GLOBAL)).toBe(false);
  });

  it("is false for an invalid address", () => {
    expect(isOnCurve("not an address")).toBe(false);
    expect(isOnCurve("")).toBe(false);
  });
});
