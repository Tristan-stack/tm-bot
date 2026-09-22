import { describe, expect, it } from "vitest";
import { addressOfSecretKey } from "./keypair.js";
import {
  generateMnemonicWallet,
  normalizeMnemonic,
  parseSeedPhrase,
  SOLANA_DERIVATION_PATH,
  walletFromMnemonic,
} from "./mnemonic.js";
import { deriveEd25519Seed } from "./slip10.js";
import {
  INVALID_PHRASES,
  TWELVE_WORDS as TWELVE,
  TWELVE_WORDS_ACCOUNT_LEVEL_ADDRESS as TWELVE_ADDRESS_ACCOUNT_LEVEL,
  TWELVE_WORDS_ADDRESS as TWELVE_ADDRESS,
  TWENTY_FOUR_WORDS as TWENTY_FOUR,
  TWENTY_FOUR_WORDS_ADDRESS as TWENTY_FOUR_ADDRESS,
} from "./test-vectors.js";

const hex = (text: string) => Buffer.from(text, "hex");

describe("deriveEd25519Seed (SLIP-0010 test vectors, ed25519)", () => {
  const seed1 = hex("000102030405060708090a0b0c0d0e0f");
  const seed2 = hex(
    "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
  );

  it.each([
    ["vector 1", seed1, "m", "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"],
    [
      "vector 1",
      seed1,
      "m/0'/1'/2'/2'/1000000000'",
      "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
    ],
    ["vector 2", seed2, "m", "171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012"],
    [
      "vector 2",
      seed2,
      "m/0'/2147483647'/1'/2147483646'/2'",
      "551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d",
    ],
  ])("derives the private key of the spec for %s at %s", (_label, seed, path, key) => {
    expect(Buffer.from(deriveEd25519Seed(seed, path)).toString("hex")).toBe(key);
  });

  it.each(["m/44'/501'/0/0", "m/44'/501'/0'/0'/", "44'/501'", "m/2147483648'"])(
    "refuses the path %s: ed25519 only has hardened children",
    (path) => {
      expect(() => deriveEd25519Seed(seed1, path)).toThrow(/derivation path/);
    },
  );
});

describe("walletFromMnemonic", () => {
  it("gives the address Phantom shows for the 12-word vector", () => {
    expect(walletFromMnemonic(TWELVE).address).toBe(TWELVE_ADDRESS);
  });

  it("gives the address Phantom shows for the 24-word vector", () => {
    expect(walletFromMnemonic(TWENTY_FOUR).address).toBe(TWENTY_FOUR_ADDRESS);
  });

  it("derives another address one level up: the 4 hardened segments matter", () => {
    expect(walletFromMnemonic(TWELVE, "m/44'/501'/0'").address).toBe(TWELVE_ADDRESS_ACCOUNT_LEVEL);
  });

  it("returns a secret key whose public half is the address", () => {
    const wallet = walletFromMnemonic(TWELVE);

    expect(wallet.secretKey).toHaveLength(64);
    expect(addressOfSecretKey(wallet.secretKey)).toBe(TWELVE_ADDRESS);
  });
});

describe("generateMnemonicWallet", () => {
  it("creates a 12-word English phrase that imports back to the same address", () => {
    const wallet = generateMnemonicWallet();
    const imported = parseSeedPhrase(wallet.mnemonic);

    expect(wallet.mnemonic.split(" ")).toHaveLength(12);
    expect(wallet.mnemonic).toBe(normalizeMnemonic(wallet.mnemonic));
    expect(wallet.derivationPath).toBe(SOLANA_DERIVATION_PATH);
    expect(imported).toMatchObject({ ok: true, address: wallet.address });
  });

  it("never repeats itself over 100 wallets", () => {
    const addresses = new Set(Array.from({ length: 100 }, () => generateMnemonicWallet().address));

    expect(addresses.size).toBe(100);
  });
});

describe("parseSeedPhrase", () => {
  it("accepts capitals, line breaks and extra spaces, and returns the normalized phrase", () => {
    const messy = `  ${TWELVE.toUpperCase().replace(/ /g, "\n  ")} \r\n`;

    const result = parseSeedPhrase(messy);

    expect(result).toMatchObject({
      ok: true,
      address: TWELVE_ADDRESS,
      derivationPath: SOLANA_DERIVATION_PATH,
      mnemonic: TWELVE,
    });
  });

  it.each([
    ["13 words", INVALID_PHRASES.thirteenWords, "invalid_word_count"],
    ["15 words", INVALID_PHRASES.fifteenWords, "invalid_word_count"],
    ["an empty text", "   ", "invalid_word_count"],
    ["a wrong checksum", INVALID_PHRASES.wrongChecksum, "invalid_mnemonic"],
    ["a word outside the wordlist", INVALID_PHRASES.unknownWord, "invalid_mnemonic"],
  ])("refuses %s", (_label, phrase, reason) => {
    expect(parseSeedPhrase(phrase)).toEqual({ ok: false, reason });
  });
});
