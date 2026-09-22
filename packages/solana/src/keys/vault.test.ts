import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "./aes-gcm.js";
import {
  InvalidMasterKeyError,
  InvalidMnemonicError,
  KeyDecryptionError,
  KeyIntegrityError,
} from "./errors.js";
import { generateKeypair } from "./keypair.js";
import { generateMnemonicWallet, parseSeedPhrase } from "./mnemonic.js";
import { revealWalletSecrets } from "./reveal.js";
import type { WalletSecretsRow, WalletSource } from "./reveal.js";
import { INVALID_PHRASES, TWENTY_FOUR_WORDS } from "./test-vectors.js";
import { createKeyVault } from "./vault.js";
import type { EncryptedSecret, KeyVault } from "./vault.js";

const masterKey = () => randomBytes(32);

/** A stored wallet: the row of a created wallet unless told otherwise. */
function storedWallet(
  vault: KeyVault,
  source: WalletSource = "CREATED",
): { row: WalletSecretsRow; secretKey: Uint8Array; mnemonic: string } {
  const wallet = generateMnemonicWallet();
  const secretKey = Uint8Array.from(wallet.secretKey);
  const mnemonic =
    source === "IMPORTED_KEY" ? null : vault.encryptMnemonic(wallet.mnemonic, wallet.address);
  return {
    row: {
      publicKey: wallet.address,
      source,
      ...vault.encrypt(wallet.secretKey, wallet.address),
      encMnemonic: mnemonic?.encMnemonic ?? null,
      mnemonicIv: mnemonic?.mnemonicIv ?? null,
      mnemonicAuthTag: mnemonic?.mnemonicAuthTag ?? null,
    },
    secretKey,
    mnemonic: wallet.mnemonic,
  };
}

const tampered = (bytes: Uint8Array, at = 0): Uint8Array<ArrayBuffer> => {
  const copy = Uint8Array.from(bytes);
  copy[at] = (copy[at] ?? 0) ^ 1;
  return copy;
};

describe("createKeyVault", () => {
  it.each([31, 33])("refuses a master key of %i bytes without echoing it", (length) => {
    expect(() => createKeyVault(randomBytes(length))).toThrow(InvalidMasterKeyError);
  });

  it("copies the master key: the caller's buffer can be zeroed", async () => {
    const key = masterKey();
    const vault = createKeyVault(key);
    const wallet = generateKeypair();
    const enc = vault.encrypt(wallet.secretKey, wallet.address);
    key.fill(0);

    const address = await vault.withSigner(enc, wallet.address, (signer) =>
      Promise.resolve(signer.publicKey.toBase58()),
    );

    expect(address).toBe(wallet.address);
  });
});

describe("encrypt / withSigner", () => {
  it("gives the signer of the address to fn and returns what fn returns", async () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateKeypair();
    const enc = vault.encrypt(wallet.secretKey, wallet.address);

    expect(enc.encSecretKey).toHaveLength(64);
    expect(enc.iv).toHaveLength(12);
    expect(enc.authTag).toHaveLength(16);
    await expect(
      vault.withSigner(enc, wallet.address, (signer) =>
        Promise.resolve(`${signer.publicKey.toBase58()}:${signer.secretKey.length}`),
      ),
    ).resolves.toBe(`${wallet.address}:64`);
  });

  it("uses a fresh IV for every call: two ciphertexts of one key differ", () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateKeypair();

    const first = vault.encrypt(wallet.secretKey, wallet.address);
    const second = vault.encrypt(wallet.secretKey, wallet.address);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.encSecretKey).not.toEqual(second.encSecretKey);
  });

  it("rethrows what fn throws", async () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateKeypair();
    const enc = vault.encrypt(wallet.secretKey, wallet.address);

    await expect(
      vault.withSigner(enc, wallet.address, () => Promise.reject(new Error("rpc down"))),
    ).rejects.toThrow("rpc down");
  });

  it("refuses to encrypt a key that does not own the address", () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateKeypair();

    expect(() => vault.encrypt(wallet.secretKey, generateKeypair().address)).toThrow(
      KeyIntegrityError,
    );
    expect(() => vault.encrypt(tampered(wallet.secretKey, 40), wallet.address)).toThrow(
      KeyIntegrityError,
    );
  });

  describe("refuses with one generic error, and no cause", () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateKeypair();
    const enc = vault.encrypt(wallet.secretKey, wallet.address);
    const failing = (
      change: Partial<EncryptedSecret>,
      address = wallet.address,
      on: KeyVault = vault,
    ) => on.withSigner({ ...enc, ...change }, address, () => Promise.resolve("signed"));

    it.each<[string, () => Promise<string>]>([
      ["a tampered tag", () => failing({ authTag: tampered(enc.authTag) })],
      ["a truncated tag", () => failing({ authTag: enc.authTag.subarray(0, 15) })],
      ["a tampered IV", () => failing({ iv: tampered(enc.iv) })],
      ["an IV of the wrong size", () => failing({ iv: enc.iv.subarray(0, 11) })],
      ["a tampered ciphertext", () => failing({ encSecretKey: tampered(enc.encSecretKey) })],
      ["another master key", () => failing({}, wallet.address, createKeyVault(masterKey()))],
      ["a ciphertext copied onto another address", () => failing({}, generateKeypair().address)],
    ])("%s", async (_label, attempt) => {
      const error = await attempt().catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(KeyDecryptionError);
      expect((error as Error).message).toBe("Wallet key decryption failed.");
      expect((error as Error).cause).toBeUndefined();
    });
  });

  it("refuses a key that decrypts but belongs to another address", async () => {
    const key = masterKey();
    const vault = createKeyVault(key);
    const [owner, other] = [generateKeypair(), generateKeypair()];
    // Bypasses the vault: the ciphertext of `other` is bound to the address of `owner`.
    const sealed = encryptSecret(key, other.secretKey, owner.address);
    const enc = { encSecretKey: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag };

    await expect(
      vault.withSigner(enc, owner.address, () => Promise.resolve("signed")),
    ).rejects.toThrow(KeyIntegrityError);
  });
});

describe("encryptMnemonic", () => {
  it("stores the normalized phrase under its own IV", () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateMnemonicWallet();

    const key = vault.encrypt(wallet.secretKey, wallet.address);
    const enc = vault.encryptMnemonic(wallet.mnemonic.toUpperCase(), wallet.address);

    expect(enc.mnemonicIv).not.toEqual(key.iv);
    expect(enc.encMnemonic).toHaveLength(Buffer.byteLength(wallet.mnemonic));
  });

  it.each([
    ["13 words", INVALID_PHRASES.thirteenWords],
    ["a wrong checksum", INVALID_PHRASES.wrongChecksum],
    ["a word outside the wordlist", INVALID_PHRASES.unknownWord],
  ])("refuses %s", (_label, mnemonic) => {
    const vault = createKeyVault(masterKey());

    expect(() => vault.encryptMnemonic(mnemonic, generateKeypair().address)).toThrow(
      InvalidMnemonicError,
    );
  });

  it("never lets a mnemonic ciphertext decrypt as a key", async () => {
    const vault = createKeyVault(masterKey());
    const wallet = generateMnemonicWallet();
    const enc = vault.encryptMnemonic(wallet.mnemonic, wallet.address);

    await expect(
      vault.withSigner(
        { encSecretKey: enc.encMnemonic, iv: enc.mnemonicIv, authTag: enc.mnemonicAuthTag },
        wallet.address,
        () => Promise.resolve("signed"),
      ),
    ).rejects.toThrow(KeyDecryptionError);
  });
});

describe("revealWalletSecrets", () => {
  it("returns the Phantom import format and the phrase of a created wallet", () => {
    const vault = createKeyVault(masterKey());
    const { row, secretKey, mnemonic } = storedWallet(vault);

    const secrets = revealWalletSecrets(row, vault);

    expect(bs58.decode(secrets.privateKeyBase58)).toEqual(secretKey);
    expect(secrets.mnemonic).toBe(mnemonic);
  });

  it("returns a 24-word phrase typed in capitals in its normalized form", () => {
    const vault = createKeyVault(masterKey());
    const imported = parseSeedPhrase(TWENTY_FOUR_WORDS.toUpperCase());
    if (!imported.ok) throw new Error(imported.reason);
    const row: WalletSecretsRow = {
      publicKey: imported.address,
      source: "IMPORTED_SEED",
      ...vault.encrypt(imported.secretKey, imported.address),
      ...vault.encryptMnemonic(TWENTY_FOUR_WORDS.toUpperCase(), imported.address),
    };

    expect(revealWalletSecrets(row, vault).mnemonic).toBe(TWENTY_FOUR_WORDS);
  });

  it("gives no phrase for a wallet imported by private key", () => {
    const vault = createKeyVault(masterKey());
    const { row, secretKey } = storedWallet(vault, "IMPORTED_KEY");

    const secrets = revealWalletSecrets(row, vault);

    expect(secrets.mnemonic).toBeNull();
    expect(bs58.decode(secrets.privateKeyBase58)).toEqual(secretKey);
  });

  it.each<[string, (row: WalletSecretsRow, vault: KeyVault) => WalletSecretsRow]>([
    ["a phrase on a key import", (row) => ({ ...row, source: "IMPORTED_KEY" })],
    ["a half-filled phrase", (row) => ({ ...row, mnemonicAuthTag: null })],
    [
      "a phrase that derives another address",
      (row, vault) => ({
        ...row,
        ...vault.encryptMnemonic(generateMnemonicWallet().mnemonic, row.publicKey),
      }),
    ],
  ])("refuses %s as a corrupted row", (_label, corrupt) => {
    const vault = createKeyVault(masterKey());
    const { row } = storedWallet(vault);

    expect(() => revealWalletSecrets(corrupt(row, vault), vault)).toThrow(KeyIntegrityError);
  });

  it("reads the key of its own vault only", () => {
    const vault = createKeyVault(masterKey());
    const { row } = storedWallet(vault);
    const impostor: KeyVault = { ...vault, withSigner: vault.withSigner.bind(vault) };

    expect(() => revealWalletSecrets(row, impostor)).toThrow(InvalidMasterKeyError);
  });
});

describe("hygiene", () => {
  it("prints [REDACTED] for every value that holds a secret, in JSON, text and inspect", () => {
    const vault = createKeyVault(masterKey());
    const { row, secretKey, mnemonic } = storedWallet(vault);
    const wallet = generateMnemonicWallet();
    const imported = parseSeedPhrase(mnemonic);
    const secrets = revealWalletSecrets(row, vault);
    const needles = [
      bs58.encode(secretKey),
      Buffer.from(secretKey).toString("hex"),
      bs58.encode(wallet.secretKey),
      Buffer.from(wallet.secretKey).toString("hex"),
      wallet.mnemonic,
      mnemonic,
    ];

    for (const value of [wallet, imported, secrets, wallet.secretKey]) {
      // The default stringification is exactly what is under test.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
      for (const printed of [JSON.stringify(value), `${value}`, String(value), inspect(value)]) {
        expect(printed).toContain("[REDACTED]");
        for (const needle of needles) expect(printed).not.toContain(needle);
      }
    }
  });

  it("zeroes a SecretBytes on dispose", () => {
    const wallet = generateKeypair();

    wallet.secretKey.dispose();

    expect(wallet.secretKey.every((byte) => byte === 0)).toBe(true);
  });

  it("keeps the fields readable for the code that needs them", () => {
    const wallet = generateMnemonicWallet();

    expect(wallet.mnemonic.split(" ")).toHaveLength(12);
    expect(wallet.secretKey).toHaveLength(64);
    expect(Object.keys(wallet).sort()).toEqual([
      "address",
      "derivationPath",
      "mnemonic",
      "secretKey",
    ]);
  });
});
