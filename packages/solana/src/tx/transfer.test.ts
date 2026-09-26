import { LAMPORTS_PER_SOL } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { getSolanaRpc, RpcUnavailableError } from "../rpc.js";
import { isTxFailure } from "./fees.js";
import {
  address,
  budgetOf,
  DEVNET_RENT_MIN,
  fakeRpc,
  milliSol,
  testContext,
  transferredLamports,
  vaultSigner,
} from "./test-rpc.js";
import {
  estimateTransferFee,
  prepareTransfer,
  sendTransfer,
  validateTransfer,
} from "./transfer.js";
import type { TransferChecks } from "./transfer.js";
import type { TransferQuote, TxContext } from "./types.js";

/** 450 units simulated, 540 asked for, at 1 000 µL: 5 000 + 1 lamport. */
const FEE = 5_001n;

afterEach(() => {
  setLogDestination(undefined);
});

describe("validateTransfer", () => {
  const checks = (over: Partial<TransferChecks>) =>
    validateTransfer({
      balance: LAMPORTS_PER_SOL,
      amount: 1n,
      fee: FEE,
      rentMin: DEVNET_RENT_MIN,
      destinationLamports: DEVNET_RENT_MIN,
      ...over,
    });
  const codes = (over: Partial<TransferChecks>) => checks(over).map((failure) => failure.code);

  it("refuses an amount of 0, and says nothing else", () => {
    expect(codes({ amount: 0n })).toEqual(["INVALID_AMOUNT"]);
    expect(codes({ amount: -1n, destinationLamports: 0n })).toEqual(["INVALID_AMOUNT"]);
  });

  it("accepts a balance left of exactly 0: an empty account needs no rent", () => {
    expect(codes({ balance: 1_000_000n, amount: 1_000_000n - FEE })).toEqual([]);
  });

  it("refuses to leave dust under the rent-exempt minimum", () => {
    const failures = checks({ balance: 1_000_000n, amount: 1_000_000n - FEE - 1n });

    expect(failures[0]).toMatchObject({
      code: "REMAINING_BELOW_RENT",
      rentMinLamports: DEVNET_RENT_MIN,
      maxLamports: 1_000_000n - FEE,
    });
  });

  it("accepts a balance left of exactly the rent-exempt minimum", () => {
    expect(codes({ balance: 1_000_000n, amount: 1_000_000n - FEE - DEVNET_RENT_MIN })).toEqual([]);
  });

  it("says how much is missing, to the lamport", () => {
    expect(checks({ balance: 1_000n, amount: 1_000n })).toEqual([
      { ok: false, code: "INSUFFICIENT_FUNDS", landed: "no", missingLamports: FEE },
    ]);
  });

  it("refuses to create an empty account below the rent-exempt minimum", () => {
    expect(codes({ amount: DEVNET_RENT_MIN - 1n, destinationLamports: 0n })).toEqual([
      "DESTINATION_BELOW_RENT",
    ]);
    expect(codes({ amount: DEVNET_RENT_MIN, destinationLamports: 0n })).toEqual([]);
  });
});

/** A funded wallet of the vault, an existing destination, 1 000 µL of priority fee. */
function harness(over: Parameters<typeof fakeRpc>[0] = {}) {
  const wallet = vaultSigner();
  const to = address();
  const fake = fakeRpc({
    fees: [1_000],
    balances: { [wallet.address]: LAMPORTS_PER_SOL, [to]: DEVNET_RENT_MIN },
    statuses: [{ confirmationStatus: "confirmed", slot: 77 }],
    ...over,
  });
  return { ...fake, ctx: testContext(fake), from: wallet.address, signer: wallet.signer, to };
}

describe("prepareTransfer", () => {
  it("quotes the transfer with fresh balances, the rent minimum and the real fees", async () => {
    const { ctx, from, to, of } = harness();

    const quote = await prepareTransfer(ctx, { from, to, amount: milliSol });

    expect(quote).toEqual({
      from,
      to,
      mode: "exact",
      amountLamports: milliSol,
      balanceLamports: LAMPORTS_PER_SOL,
      destinationLamports: DEVNET_RENT_MIN,
      rentMinLamports: DEVNET_RENT_MIN,
      fee: {
        microLamportsPerCu: 1_000n,
        computeUnitLimit: 540,
        baseFeeLamports: 5_000n,
        priorityFeeLamports: 1n,
        totalFeeLamports: FEE,
      },
    });
    expect(of("getMultipleAccountsInfo")).toHaveLength(1);
  });

  it("refuses an amount over the balance before it simulates anything", async () => {
    const { ctx, from, to, of } = harness();

    const failure = await prepareTransfer(ctx, { from, to, amount: LAMPORTS_PER_SOL + 1n });

    expect(failure).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      missingLamports: 1n,
    });
    expect(of("simulateTransaction")).toHaveLength(0);
  });

  it("refuses a dust amount to an address that does not exist yet, without simulating", async () => {
    const { ctx, from, of } = harness();

    const failure = await prepareTransfer(ctx, {
      from,
      to: address(),
      amount: DEVNET_RENT_MIN - 1n,
    });

    expect(failure).toMatchObject({
      code: "DESTINATION_BELOW_RENT",
      rentMinLamports: DEVNET_RENT_MIN,
    });
    expect(of("simulateTransaction")).toHaveLength(0);
  });

  it("refuses an amount of 0", async () => {
    const { ctx, from, to } = harness();

    expect(await prepareTransfer(ctx, { from, to, amount: 0n })).toMatchObject({
      code: "INVALID_AMOUNT",
    });
  });

  it("simulates Max on a provisional amount, never on the whole balance", async () => {
    const { ctx, from, to, simulated } = harness();

    const quote = await prepareTransfer(ctx, { from, to, amount: "max" });

    expect(transferredLamports(simulated[0]!)).toBe(DEVNET_RENT_MIN);
    expect(quote).toMatchObject({ mode: "max", amountLamports: LAMPORTS_PER_SOL - FEE });
  });

  it("simulates 0 for Max when the balance is under the rent-exempt minimum", async () => {
    const from = address();
    const { ctx, to, simulated } = harness({ balances: { [from]: 100_000n } });

    await prepareTransfer(ctx, { from, to, amount: "max" });

    expect(transferredLamports(simulated[0]!)).toBe(0n);
  });

  it("takes the fees out of a debit, simulated on a provisional amount", async () => {
    const { ctx, from, to, simulated } = harness();
    const debit = 100n * milliSol;

    const quote = await prepareTransfer(ctx, { from, to, amount: { debit } });

    expect(transferredLamports(simulated[0]!)).toBe(DEVNET_RENT_MIN);
    expect(quote).toMatchObject({ mode: "debit", amountLamports: debit - FEE });
  });

  it("refuses a debit over the balance before it simulates anything", async () => {
    const { ctx, from, to, of } = harness();

    const failure = await prepareTransfer(ctx, {
      from,
      to,
      amount: { debit: LAMPORTS_PER_SOL + 5n },
    });

    expect(failure).toMatchObject({ code: "INSUFFICIENT_FUNDS", missingLamports: 5n });
    expect(of("simulateTransaction")).toHaveLength(0);
  });

  it("moves the whole balance rather than leave a dust under the rent-exempt minimum", async () => {
    const { ctx, from, to } = harness();

    expect(
      await prepareTransfer(ctx, { from, to, amount: { debit: LAMPORTS_PER_SOL - 1n } }),
    ).toMatchObject({ mode: "debit", amountLamports: LAMPORTS_PER_SOL - FEE });
    // What stays is the rent-exempt minimum or more: the debit is taken as it is.
    expect(
      await prepareTransfer(ctx, {
        from,
        to,
        amount: { debit: LAMPORTS_PER_SOL - DEVNET_RENT_MIN },
      }),
    ).toMatchObject({ amountLamports: LAMPORTS_PER_SOL - DEVNET_RENT_MIN - FEE });
  });

  it("refuses a debit of 0, or one the fees would eat whole", async () => {
    const { ctx, from, to } = harness();

    expect(await prepareTransfer(ctx, { from, to, amount: { debit: 0n } })).toMatchObject({
      code: "INVALID_AMOUNT",
    });
    expect(await prepareTransfer(ctx, { from, to, amount: { debit: FEE } })).toMatchObject({
      code: "INVALID_AMOUNT",
    });
  });

  it("reads the rent-exempt minimum once per connection", async () => {
    const { ctx, from, to, of } = harness();

    await prepareTransfer(ctx, { from, to, amount: milliSol });
    await prepareTransfer(ctx, { from, to, amount: milliSol });

    expect(of("getMinimumBalanceForRentExemption")).toHaveLength(1);
  });

  it("maps a rent failure of the destination and one of the payer apart", async () => {
    captureLogs();
    const destination = harness({
      simulationError: { InsufficientFundsForRent: { account_index: 1 } },
    });
    const payer = harness({ simulationError: { InsufficientFundsForRent: { account_index: 0 } } });

    expect(
      await prepareTransfer(destination.ctx, {
        from: destination.from,
        to: destination.to,
        amount: milliSol,
      }),
    ).toMatchObject({
      code: "DESTINATION_BELOW_RENT",
      landed: "no",
      rentMinLamports: DEVNET_RENT_MIN,
    });
    expect(
      await prepareTransfer(payer.ctx, { from: payer.from, to: payer.to, amount: milliSol }),
    ).toMatchObject({
      code: "REMAINING_BELOW_RENT",
      landed: "no",
      rentMinLamports: DEVNET_RENT_MIN,
    });
  });

  it("maps the insufficient funds of the System program", async () => {
    captureLogs();
    const { ctx, from, to } = harness({
      simulationError: { InstructionError: [2, { Custom: 1 }] },
    });

    expect(await prepareTransfer(ctx, { from, to, amount: milliSol })).toEqual({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      detail: '{"InstructionError":[2,{"Custom":1}]}',
      rentMinLamports: DEVNET_RENT_MIN,
    });
  });

  it("says the RPC is down when the balances cannot be read", async () => {
    captureLogs();
    const { ctx, from, to } = harness({
      throws: { getMultipleAccountsInfo: new RpcUnavailableError("The RPC did not answer") },
    });

    expect(await prepareTransfer(ctx, { from, to, amount: milliSol })).toEqual({
      ok: false,
      code: "RPC_UNAVAILABLE",
      landed: "no",
    });
  });
});

describe("estimateTransferFee", () => {
  it("prices a standard transfer with the priority fee of the moment, without simulating", async () => {
    const { ctx, from, methods } = harness({ fees: [1_000_000] });

    // 1 000 compute units at the ceiling of the bounds: 5 000 + 1 000 lamports.
    expect(await estimateTransferFee(ctx, from)).toBe(6_000n);
    expect(methods()).toEqual(["getRecentPrioritizationFees"]);
  });
});

describe("sendTransfer", () => {
  const quoteOf = (over: Partial<TransferQuote>): TransferQuote => ({
    from: address(),
    to: address(),
    mode: "exact",
    amountLamports: milliSol,
    balanceLamports: LAMPORTS_PER_SOL,
    destinationLamports: DEVNET_RENT_MIN,
    rentMinLamports: DEVNET_RENT_MIN,
    fee: {
      microLamportsPerCu: 0n,
      computeUnitLimit: 540,
      baseFeeLamports: 5_000n,
      priorityFeeLamports: 0n,
      totalFeeLamports: 5_000n,
    },
    ...over,
  });

  it("sends what the quote said, and reports what moved", async () => {
    const { ctx, from, to, signer, sent } = harness();

    const result = await sendTransfer(ctx, quoteOf({ from, to }), signer);

    expect(result).toMatchObject({ ok: true, slot: 77, amountLamports: milliSol });
    expect(transferredLamports(VersionedTransaction.deserialize(sent[0]!))).toBe(milliSol);
  });

  it("refuses an exact amount whose fees no longer fit in the balance", async () => {
    captureLogs();
    const from = address();
    // The balance dropped between the quote and the confirmation.
    const { ctx, to, signer, sent } = harness({ balances: { [from]: milliSol } });

    const result = await sendTransfer(ctx, quoteOf({ from, to }), signer);

    expect(result).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      missingLamports: FEE,
    });
    expect(sent).toHaveLength(0);
  });

  it("reads the destination again: an account emptied since the quote needs its rent", async () => {
    const { ctx, from, signer, sent } = harness();

    const result = await sendTransfer(
      ctx,
      quoteOf({ from, to: address(), amountLamports: DEVNET_RENT_MIN - 1n }),
      signer,
    );

    expect(result).toMatchObject({ code: "DESTINATION_BELOW_RENT", landed: "no" });
    expect(sent).toHaveLength(0);
  });

  it("lowers a Max amount when the priority fee went up, and still leaves 0", async () => {
    const { ctx, from, to, signer, sent } = harness({ fees: [1_000_000] });

    const result = await sendTransfer(ctx, quoteOf({ from, to, mode: "max" }), signer);

    // 540 units at the ceiling: 5 000 + 540 lamports, and the amount follows.
    const amount = LAMPORTS_PER_SOL - 5_540n;
    expect(result).toMatchObject({ ok: true, amountLamports: amount });
    expect(transferredLamports(VersionedTransaction.deserialize(sent[0]!))).toBe(amount);
  });

  it("follows the fee of a second attempt down to the lamport, in Max mode", async () => {
    captureLogs();
    const { ctx, from, to, signer, sent, state } = harness({
      // The first blockhash expires with nothing landed; the second attempt is confirmed.
      statuses: [null, { confirmationStatus: "confirmed" }],
      heights: [201],
      lastValidBlockHeight: 200,
      onCall: (method) => {
        if (method === "getLatestBlockhash") state.fees = [1_000_000];
      },
    });

    const result = await sendTransfer(ctx, quoteOf({ from, to, mode: "max" }), signer);

    const amount = LAMPORTS_PER_SOL - 5_540n;
    expect(result).toMatchObject({ ok: true, amountLamports: amount });
    expect(sent).toHaveLength(2);
    expect(transferredLamports(VersionedTransaction.deserialize(sent[0]!))).toBe(
      LAMPORTS_PER_SOL - FEE,
    );
    expect(transferredLamports(VersionedTransaction.deserialize(sent[1]!))).toBe(amount);
  });

  it("takes the fee of a second attempt out of a debit: the wallet pays exactly its total", async () => {
    captureLogs();
    const debit = 100n * milliSol;
    const { ctx, from, to, signer, sent, state } = harness({
      // The first blockhash expires with nothing landed; the second attempt is confirmed.
      statuses: [null, { confirmationStatus: "confirmed" }],
      heights: [201],
      lastValidBlockHeight: 200,
      onCall: (method) => {
        if (method === "getLatestBlockhash") state.fees = [1_000_000];
      },
    });

    const result = await sendTransfer(
      ctx,
      quoteOf({ from, to, mode: "debit", amountLamports: debit }),
      signer,
    );

    expect(result).toMatchObject({ ok: true, amountLamports: debit - 5_540n });
    expect(sent).toHaveLength(2);
    expect(transferredLamports(VersionedTransaction.deserialize(sent[0]!))).toBe(debit - FEE);
    expect(transferredLamports(VersionedTransaction.deserialize(sent[1]!))).toBe(debit - 5_540n);
  });

  it("hands the quote over before signing, then the signature before the confirmation", async () => {
    const { ctx, from, to, signer } = harness();
    const seen: string[] = [];

    const result = await sendTransfer(ctx, quoteOf({ from, to }), signer, {
      onPrepared: (quote) => {
        seen.push(`prepared:${quote.amountLamports}`);
        return Promise.resolve();
      },
      onSubmitted: (signature) => {
        seen.push(`submitted:${signature.slice(0, 4)}`);
        return Promise.resolve();
      },
    });

    expect(result.ok && seen).toEqual([
      `prepared:${milliSol}`,
      `submitted:${result.ok ? result.signature.slice(0, 4) : ""}`,
    ]);
  });

  it("hands the signature over before the confirmation", async () => {
    const { ctx, from, to, signer, methods } = harness();
    const submitted: string[] = [];

    const result = await sendTransfer(ctx, quoteOf({ from, to }), signer, {
      onSubmitted: (signature) => {
        submitted.push(signature);
        return Promise.resolve();
      },
    });

    expect(result.ok && submitted).toEqual([result.ok ? result.signature : ""]);
    expect(methods().indexOf("getSignatureStatuses")).toBeGreaterThan(
      methods().indexOf("sendRawTransaction"),
    );
  });
});

// Needs the network and a devnet airdrop: RUN_DEVNET_TESTS=1.
describe.skipIf(!process.env["RUN_DEVNET_TESTS"])("transfer (devnet)", () => {
  it("moves 0.001 SOL and charges what it estimated", async ({ skip }) => {
    const rpc = getSolanaRpc("https://api.devnet.solana.com");
    const payer = Keypair.generate();
    const to = address();

    // An airdrop devnet refuses is not a failure of ours: the test says so, and stops.
    try {
      const airdrop = await rpc.requestAirdrop(payer.publicKey, Number(LAMPORTS_PER_SOL) / 100);
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash("confirmed");
      await rpc.confirmTransaction({ signature: airdrop, blockhash, lastValidBlockHeight });
    } catch (error) {
      skip(`devnet refused the airdrop: ${error instanceof Error ? error.message : String(error)}`);
    }

    const ctx: TxContext = {
      rpc,
      priorityFee: { minMicroLamports: 0, maxMicroLamports: 1_000_000 },
    };
    const quote = await prepareTransfer(ctx, {
      from: payer.publicKey.toBase58(),
      to,
      amount: milliSol,
    });
    if (isTxFailure(quote)) throw new Error(`prepare failed: ${quote.code}`);

    const result = await sendTransfer(ctx, quote, { kind: "ephemeral", signer: payer });
    if (!result.ok) throw new Error(`send failed: ${result.code}`);

    const landed = await rpc.getTransaction(result.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    expect(landed?.meta?.fee).toBe(Number(result.feeLamports));
    const { microLamportsPerCu, computeUnitLimit } = budgetOf(
      new VersionedTransaction(landed!.transaction.message),
    );
    expect(computeUnitLimit).toBe(quote.fee.computeUnitLimit);
    expect(microLamportsPerCu).toBeLessThanOrEqual(1_000_000n);
  }, 120_000);
});
