import { chunk, MAX_ACCOUNTS_PER_READ } from "@launchbot/shared";
import { PublicKey } from "@solana/web3.js";
import type { Commitment, Connection } from "@solana/web3.js";

export type BalancesReader = Pick<Connection, "getMultipleAccountsInfo">;

/**
 * Balances in lamports, by address, in one grouped call: no cache and no throttle, the caller
 * applies its own limits. For what the user sees, use the balance service of @launchbot/db.
 * `commitment` defaults to the one of the connection, `confirmed`.
 */
export async function getBalancesFresh(
  rpc: BalancesReader,
  addresses: readonly string[],
  commitment?: Commitment,
): Promise<Map<string, bigint>> {
  const accounts = (
    await Promise.all(
      chunk(addresses, MAX_ACCOUNTS_PER_READ).map((slice) =>
        rpc.getMultipleAccountsInfo(
          slice.map((address) => new PublicKey(address)),
          commitment,
        ),
      ),
    )
  ).flat();

  // An address that never received anything has no account: that is 0 SOL, not an error.
  return new Map(
    addresses.map((address, index) => [address, BigInt(accounts[index]?.lamports ?? 0)]),
  );
}
