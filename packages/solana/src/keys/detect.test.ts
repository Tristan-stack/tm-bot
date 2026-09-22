import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { looksLikePrivateKey, looksLikeSeedPhrase } from "./detect.js";
import { generateKeypair } from "./keypair.js";
import { generateMnemonicWallet } from "./mnemonic.js";

describe("looksLikePrivateKey", () => {
  const wallet = generateKeypair();
  const exported = bs58.encode(wallet.secretKey);

  it.each([
    ["a base58 key alone", exported],
    ["a base58 key inside a message", `here is my key ${exported} please help`],
    ["the JSON array of solana-keygen", `[${[...wallet.secretKey].join(", ")}]`],
    ["a JSON array on several lines", `[\n${[...wallet.secretKey].join(",\n")}\n]`],
    // A signature is 64 bytes too: an accepted false positive.
    ["a transaction signature", bs58.encode(Buffer.alloc(64, 7))],
  ])("detects %s", (_label, text) => {
    expect(looksLikePrivateKey(text)).toBe(true);
  });

  it.each([
    ["an address", wallet.address],
    ["a token name", "PEPE"],
    ["a sentence", "I want to withdraw 2.5 SOL to my main wallet"],
    ["a JSON array of 63 numbers", `[${[...wallet.secretKey.subarray(0, 63)].join(",")}]`],
    ["a JSON array with a value above 255", `[${[...wallet.secretKey.subarray(1)].join(",")},256]`],
    ["a base58 run of 100 characters", "1".repeat(100)],
  ])("ignores %s", (_label, text) => {
    expect(looksLikePrivateKey(text)).toBe(false);
  });
});

describe("looksLikeSeedPhrase", () => {
  const twelve = generateMnemonicWallet().mnemonic;
  const withTypo = (phrase: string, ...at: number[]) =>
    phrase
      .split(" ")
      .map((word, index) => (at.includes(index) ? `${word}x` : word))
      .join(" ");

  it.each([
    ["12 words", twelve],
    ["12 words in capitals on several lines", twelve.toUpperCase().replace(/ /g, "\n")],
    ["a phrase inside a message", `my seed is ${twelve} thanks`],
    ["24 words", `${twelve} ${twelve}`],
    ["12 words with one typo", withTypo(twelve, 3)],
  ])("detects %s", (_label, text) => {
    expect(looksLikeSeedPhrase(text)).toBe(true);
  });

  it.each([
    ["11 words", twelve.split(" ").slice(1).join(" ")],
    ["12 words with two typos", withTypo(twelve, 3, 8)],
    [
      "everyday English",
      "the bot is not answering and I would like to know if the launch is still planned for today",
    ],
    ["a token name", "PEPE"],
    ["an empty text", ""],
  ])("ignores %s", (_label, text) => {
    expect(looksLikeSeedPhrase(text)).toBe(false);
  });
});
