import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { addressOfSecretKey, generateKeypair } from "./keypair.js";
import { parsePrivateKey } from "./private-key.js";
import { SecretBytes } from "./secret-bytes.js";

describe("generateKeypair", () => {
  it("returns 64 bytes whose public half is the address", () => {
    const wallet = generateKeypair();

    expect(wallet.secretKey).toBeInstanceOf(SecretBytes);
    expect(wallet.secretKey).toHaveLength(64);
    expect(addressOfSecretKey(wallet.secretKey)).toBe(wallet.address);
  });

  it("never repeats itself over 1 000 keypairs", () => {
    const addresses = new Set(Array.from({ length: 1000 }, () => generateKeypair().address));

    expect(addresses.size).toBe(1000);
  });
});

describe("parsePrivateKey", () => {
  const wallet = generateKeypair();
  const exported = bs58.encode(wallet.secretKey);

  it("accepts the base58 export of Phantom, with spaces and line breaks around", () => {
    const result = parsePrivateKey(`  \n${exported}\r\n `);

    expect(result).toMatchObject({
      ok: true,
      address: wallet.address,
      derivationPath: null,
      mnemonic: null,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.secretKey).toEqual(wallet.secretKey);
  });

  it.each([
    ["an empty text", "", "invalid_base58"],
    ["a space inside", `${exported.slice(0, 40)} ${exported.slice(40)}`, "invalid_base58"],
    ["the characters 0 O I l", `0OIl${exported.slice(4)}`, "invalid_base58"],
    ["the JSON array of solana-keygen", `[${[...wallet.secretKey].join(",")}]`, "invalid_base58"],
    ["32 bytes: an address", wallet.address, "invalid_length"],
    ["63 bytes", bs58.encode(wallet.secretKey.subarray(0, 63)), "invalid_length"],
    ["65 bytes", bs58.encode(Buffer.concat([wallet.secretKey, Buffer.alloc(1)])), "invalid_length"],
  ])("refuses %s", (_label, input, reason) => {
    expect(parsePrivateKey(input)).toEqual({ ok: false, reason });
  });

  it("refuses a key whose public half was altered", () => {
    const altered = Uint8Array.from(wallet.secretKey);
    altered[63] = (altered[63] ?? 0) ^ 1;

    expect(parsePrivateKey(bs58.encode(altered))).toEqual({
      ok: false,
      reason: "public_key_mismatch",
    });
  });
});
