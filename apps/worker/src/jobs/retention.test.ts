import type {
  AccountOutcome,
  DataCleanupService,
  InactiveAccountsService,
  InactiveUser,
} from "@launchbot/db";
import {
  createUi,
  HOUR_MS,
  INACTIVE_ACCOUNTS_PAGE_SIZE,
  INACTIVITY_DELETE_MS,
} from "@launchbot/shared";
import type { SweptTransfer } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cronEvery } from "../boss.js";
import type { TelegramSender } from "../telegram.js";
import { createRetentionJobs, runInactiveAccountsJob } from "./retention.js";

const ui = createUi("devnet");
const AT = new Date("2026-09-24T12:00:00Z");
const CUTOFF = new Date(AT.getTime() - INACTIVITY_DELETE_MS);
const ADMIN = 999;
const TRANSFER: SweptTransfer = {
  walletName: "Main",
  fromAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  lamports: 2_499_985_000n,
  signature: `5Hq1${"x".repeat(80)}Zk9a`,
};

afterEach(() => {
  setLogDestination(undefined);
});

let nextId = 1;
const user = (overrides: Partial<InactiveUser> = {}): InactiveUser => ({
  id: `u${nextId++}`,
  telegramId: BigInt(1_000 + nextId),
  username: "otter_fan",
  firstName: null,
  lastActiveAt: new Date(AT.getTime() - INACTIVITY_DELETE_MS - HOUR_MS),
  ...overrides,
});

function accountsWith(
  pages: InactiveUser[][],
  outcomeOf: (user: InactiveUser) => AccountOutcome | Error,
) {
  const queue = [...pages];
  const accounts: InactiveAccountsService = {
    resolvePendingSweeps: vi.fn(() => Promise.resolve({ confirmed: 0, failed: 0, unresolved: 0 })),
    listCandidates: vi.fn(() => Promise.resolve(queue.shift() ?? [])),
    processAccount: vi.fn((candidate: InactiveUser) => {
      const outcome = outcomeOf(candidate);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
  };
  const notifyAdmins = vi.fn<TelegramSender["notifyAdmins"]>(() => Promise.resolve());
  return {
    accounts,
    notifyAdmins,
    deps: { accounts, adminIds: [ADMIN], telegram: { notifyAdmins }, ui },
  };
}

describe("runInactiveAccountsJob (V1-45)", () => {
  it("settles the transfers in flight first, then reads the pages on a cursor", async () => {
    captureLogs();
    const first = Array.from({ length: INACTIVE_ACCOUNTS_PAGE_SIZE }, () => user());
    const second = [user()];
    const { accounts, deps } = accountsWith([first, second], () => ({
      status: "DELETED",
      transfers: [],
      counts: {
        wallets: 0,
        drafts: 0,
        simulations: 0,
        aiGenerations: 0,
        subscriptions: 0,
        payments: 0,
        withdrawals: 0,
      },
    }));

    const report = await runInactiveAccountsJob(deps, AT);

    expect(report).toEqual({ scanned: 101, deleted: 101, kept: 0, swept: 0, failed: 0 });
    expect(vi.mocked(accounts.resolvePendingSweeps).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(accounts.listCandidates).mock.invocationCallOrder[0] ?? 0,
    );
    expect(vi.mocked(accounts.listCandidates).mock.calls).toEqual([
      [CUTOFF, [ADMIN], undefined],
      [CUTOFF, [ADMIN], first.at(-1)],
    ]);
    expect(vi.mocked(accounts.processAccount).mock.calls[0]?.[1]).toEqual(CUTOFF);
  });

  it("sends nothing to the user, before or after the deletion of their account (§15)", async () => {
    captureLogs();
    const { deps, notifyAdmins } = accountsWith([[user()]], () => ({
      status: "DELETED",
      transfers: [TRANSFER],
      counts: {
        wallets: 1,
        drafts: 0,
        simulations: 0,
        aiGenerations: 0,
        subscriptions: 1,
        payments: 1,
        withdrawals: 1,
      },
    }));
    // A whole sender, as the worker has one: the job must still only know the admins.
    const sendScreen = vi.fn<TelegramSender["sendScreen"]>();
    const telegram: TelegramSender = { notifyAdmins, sendScreen };

    expect(await runInactiveAccountsJob({ ...deps, telegram }, AT)).toMatchObject({ deleted: 1 });
    expect(sendScreen).not.toHaveBeenCalled();
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("never touches an admin nor an account active within 24 h, whatever a page holds", async () => {
    const admin = user({ telegramId: BigInt(ADMIN) });
    const recent = user({ lastActiveAt: new Date(AT.getTime() - INACTIVITY_DELETE_MS + HOUR_MS) });
    const { accounts, deps } = accountsWith([[admin, recent]], () => ({ status: "NOT_FOUND" }));

    expect(await runInactiveAccountsJob(deps, AT)).toMatchObject({ scanned: 0 });
    expect(accounts.processAccount).not.toHaveBeenCalled();
  });

  it("tells the admins once when a user came back after their SOL left", async () => {
    const back = user({ username: "otter_fan" });
    const quiet = user();
    const { notifyAdmins, deps } = accountsWith([[back, quiet]], (candidate) =>
      candidate === back
        ? { status: "ACTIVE", transfers: [TRANSFER] }
        : { status: "ACTIVE", transfers: [] },
    );

    expect(await runInactiveAccountsJob(deps, AT)).toMatchObject({ kept: 2, swept: 1 });

    expect(notifyAdmins).toHaveBeenCalledOnce();
    const alert = notifyAdmins.mock.calls[0]?.[0].text ?? "";
    expect(alert).toContain("⚠️ MANUAL REFUND");
    expect(alert).toContain("👤 User: @otter_fan (ID <code>");
    expect(alert).toContain("Moved to treasury: 2.499985 SOL");
  });

  it("counts the accounts kept by a failure, and goes on after an error", async () => {
    captureLogs();
    const failing = user();
    const pending = user();
    const funded = user();
    const deleted = user();
    const { deps } = accountsWith([[failing, pending, funded, deleted]], (candidate) => {
      if (candidate === failing) return new Error("database down");
      if (candidate === pending) return { status: "KEPT", reason: "TX_PENDING", transfers: [] };
      if (candidate === funded)
        return { status: "KEPT", reason: "FUNDS_LEFT", transfers: [TRANSFER] };
      return {
        status: "DELETED",
        transfers: [TRANSFER],
        counts: {
          wallets: 1,
          drafts: 0,
          simulations: 0,
          aiGenerations: 0,
          subscriptions: 0,
          payments: 0,
          withdrawals: 1,
        },
      };
    });

    expect(await runInactiveAccountsJob(deps, AT)).toEqual({
      scanned: 4,
      deleted: 1,
      kept: 1,
      swept: 2,
      failed: 2,
    });
  });
});

describe("createRetentionJobs (V1-45)", () => {
  function jobs() {
    const { deps } = accountsWith([], () => ({ status: "NOT_FOUND" }));
    const cleanup: DataCleanupService = {
      runExpiredCleanup: vi.fn(() =>
        Promise.resolve({ simulations: 0, drafts: 0, aiGenerations: 0 }),
      ),
    };
    return { cleanup, jobs: createRetentionJobs({ ...deps, cleanup, now: () => AT }) };
  }

  it("runs at the clock of the worker, or at the one of a launch by hand", async () => {
    const { cleanup, jobs: retention } = jobs();

    await retention.cleanup({});
    await retention.cleanup({ now: "2026-12-24T03:30:00.000Z" });

    expect(vi.mocked(cleanup.runExpiredCleanup).mock.calls).toEqual([
      [AT],
      [new Date("2026-12-24T03:30:00Z")],
    ]);
    await expect(retention.cleanup({ now: "tomorrow" })).rejects.toThrow("not a date");
  });
});

describe("cronEvery", () => {
  it.each([
    [60_000, "* * * * *"],
    [15 * 60_000, "*/15 * * * *"],
    [30 * 60_000, "*/30 * * * *"],
  ])("%d ms → %s", (ms, cron) => {
    expect(cronEvery(ms)).toBe(cron);
  });

  it.each([90_000, 7 * 60_000, 0, 120 * 60_000])("refuses %d ms", (ms) => {
    expect(() => cronEvery(ms)).toThrow("whole minutes that divide an hour");
  });
});
