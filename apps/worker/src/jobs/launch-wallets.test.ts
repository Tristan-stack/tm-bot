import type { LaunchSweepOutcome, LaunchSweepService } from "@launchbot/db";
import type { SweptTransfer } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLaunchWalletsJob } from "./launch-wallets.js";

const AT = new Date("2026-09-26T12:00:00Z");
const TRANSFER: SweptTransfer = {
  walletName: "Launch $OTTR · 8oHs3P",
  fromAddress: "8oHs3PqQ9WmYtZbLpD2rVxJk4NcAeFgH7sTuMwXyBz1K",
  lamports: 39_990_000n,
  signature: `5Hq1${"x".repeat(80)}Zk9a`,
};

afterEach(() => {
  setLogDestination(undefined);
});

function launchWalletsWith(outcomes: Record<string, LaunchSweepOutcome | Error>) {
  const service: LaunchSweepService = {
    listDue: vi.fn(() => Promise.resolve(Object.keys(outcomes))),
    sweepLaunchWallet: vi.fn((walletId: string) => {
      const outcome = outcomes[walletId] ?? { status: "NOT_FOUND" };
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
  };
  return service;
}

describe("runLaunchWalletsJob (decision of 26/09/2026)", () => {
  it("sweeps each launch wallet due, one failing leaving the others to go", async () => {
    const logs = captureLogs();
    const service = launchWalletsWith({
      erased: { status: "ERASED", transfers: [TRANSFER] },
      empty: { status: "ERASED", transfers: [] },
      inFlight: { status: "KEPT", reason: "TX_PENDING", transfers: [] },
      broken: new Error("database down"),
      gone: { status: "NOT_FOUND" },
    });

    expect(await runLaunchWalletsJob(service, AT)).toEqual({
      due: 5,
      erased: 2,
      swept: 1,
      kept: 1,
      failed: 1,
    });
    expect(service.listDue).toHaveBeenCalledWith(AT);
    expect(service.sweepLaunchWallet).toHaveBeenCalledTimes(5);
    const entries = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry["msg"] === "launch.wallet_failed")).toMatchObject({
      walletId: "broken",
    });
    expect(entries.find((entry) => entry["msg"] === "launch.pass")).toMatchObject({
      due: 5,
      erased: 2,
    });
  });

  it("says nothing when no launch wallet is due", async () => {
    const logs = captureLogs();

    expect(await runLaunchWalletsJob(launchWalletsWith({}), AT)).toEqual({
      due: 0,
      erased: 0,
      swept: 0,
      kept: 0,
      failed: 0,
    });
    expect(logs).toEqual([]);
  });
});
