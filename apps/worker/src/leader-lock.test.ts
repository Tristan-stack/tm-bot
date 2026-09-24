import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { createLeaderLock } from "./leader-lock.js";
import type { LockClient } from "./leader-lock.js";

afterEach(() => {
  setLogDestination(undefined);
});

/** A connection whose answers the test scripts: `locked` per query, an `error` it can emit. */
function fakeClients(answers: boolean[]) {
  const clients: {
    queries: string[];
    ended: boolean;
    fail: (error: Error) => void;
  }[] = [];
  const connect = vi.fn((): LockClient => {
    let onError: (error: Error) => void = () => undefined;
    const record = { queries: [] as string[], ended: false, fail: (e: Error) => onError(e) };
    clients.push(record);
    return {
      connect: () => Promise.resolve(),
      query: (text: string) => {
        record.queries.push(text);
        return Promise.resolve({ rows: [{ locked: answers.shift() ?? false }] });
      },
      end: () => {
        record.ended = true;
        return Promise.resolve();
      },
      on: (event, listener) => {
        if (event === "error") onError = listener;
      },
    };
  });
  return { connect, clients };
}

const lockOf = (options: Partial<Parameters<typeof createLeaderLock>[0]> = {}) =>
  createLeaderLock({ connectionString: "postgres://x", key: "worker:payments", ...options });

describe("createLeaderLock (V1-32, proposal)", () => {
  it("takes the session lock once and keeps it without asking again", async () => {
    const { connect, clients } = fakeClients([true]);
    const lock = lockOf({
      connect,
    });

    await expect(lock.acquire()).resolves.toBe(true);
    await expect(lock.acquire()).resolves.toBe(true);

    expect(connect).toHaveBeenCalledOnce();
    expect(clients[0]?.queries).toEqual(["SELECT pg_try_advisory_lock(hashtext($1)) AS locked"]);
  });

  it("waits `retryMs` before asking again when another worker holds it", async () => {
    let clock = 0;
    const { clients, connect } = fakeClients([false, true]);
    const lock = lockOf({
      retryMs: 30_000,
      now: () => clock,
      connect,
    });

    await expect(lock.acquire()).resolves.toBe(false);
    clock = 29_999;
    await expect(lock.acquire()).resolves.toBe(false);
    expect(clients[0]?.queries).toHaveLength(1);
    clock = 30_000;
    await expect(lock.acquire()).resolves.toBe(true);
  });

  it("loses the lock with its connection, and reconnects on the next attempt", async () => {
    captureLogs();
    let clock = 0;
    const { clients, connect } = fakeClients([true, true]);
    const lock = lockOf({
      now: () => clock,
      connect,
    });

    await lock.acquire();
    clients[0]?.fail(new Error("Connection terminated unexpectedly"));
    clock = 30_000;

    await expect(lock.acquire()).resolves.toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("answers false when the database cannot be reached", async () => {
    const lines = captureLogs();
    const lock = lockOf({
      connect: () => ({
        connect: () => Promise.reject(new Error("ECONNREFUSED")),
        query: () => Promise.reject(new Error("unreachable")),
        end: () => Promise.resolve(),
        on: () => undefined,
      }),
    });

    await expect(lock.acquire()).resolves.toBe(false);
    expect(lines.join("")).toContain("worker.leader_unavailable");
  });

  it("release unlocks and closes the connection", async () => {
    const { connect, clients } = fakeClients([true]);
    const lock = lockOf({
      connect,
    });

    await lock.acquire();
    await lock.release();

    expect(clients[0]?.queries.at(-1)).toBe("SELECT pg_advisory_unlock(hashtext($1))");
    expect(clients[0]?.ended).toBe(true);
  });
});
