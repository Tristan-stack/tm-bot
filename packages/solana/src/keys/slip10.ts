import { createHmac } from "node:crypto";

const MASTER_HMAC_KEY = "ed25519 seed";
const HARDENED_OFFSET = 0x80000000;
/** ed25519 only has hardened children (SLIP-0010): every segment ends with `'`. */
const HARDENED_PATH = /^m(\/\d+')*$/;

/**
 * SLIP-0010 for ed25519: the 32-byte private key of `path` under a BIP39 seed, the way
 * Phantom and Solflare derive an account. Intermediate keys and chain codes are zeroed.
 */
export function deriveEd25519Seed(seed: Uint8Array, path: string): Uint8Array {
  if (!HARDENED_PATH.test(path)) throw new Error(`Unsupported derivation path: ${path}`);
  let node = createHmac("sha512", MASTER_HMAC_KEY).update(seed).digest();
  const segments = path === "m" ? [] : path.slice(2).split("/");
  for (const segment of segments) {
    const index = Number(segment.slice(0, -1));
    if (index >= HARDENED_OFFSET) throw new Error(`Unsupported derivation path: ${path}`);
    // 0x00 ‖ key ‖ hardened index, keyed by the chain code of the parent.
    const data = Buffer.alloc(1 + 32 + 4);
    node.copy(data, 1, 0, 32);
    data.writeUInt32BE(index + HARDENED_OFFSET, 33);
    const child = createHmac("sha512", node.subarray(32)).update(data).digest();
    node.fill(0);
    data.fill(0);
    node = child;
  }
  const key = new Uint8Array(node.subarray(0, 32));
  node.fill(0);
  return key;
}
