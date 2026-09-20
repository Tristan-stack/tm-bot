import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "./lifecycle.js";
import { scrubError } from "./scrub.js";
import type { Service } from "./lifecycle.js";

// Typed loosely on purpose: process.on is overloaded per event name, and these four differ.
const events = process as unknown as {
  listeners: (event: string) => ((...args: unknown[]) => void)[];
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
  emit: (event: string) => boolean;
};
const SIGNALS = ["SIGINT", "SIGTERM", "unhandledRejection", "uncaughtException"];

// runProcess listens on process signals: the test run must not keep those listeners.
let existing: Map<string, ((...args: unknown[]) => void)[]>;

beforeEach(() => {
  existing = new Map(SIGNALS.map((signal) => [signal, events.listeners(signal)]));
});

afterEach(() => {
  for (const [signal, listeners] of existing) {
    for (const listener of events.listeners(signal)) {
      if (!listeners.includes(listener)) events.off(signal, listener);
    }
  }
});

const trace = (name: string, log: string[]): Service => ({
  name,
  start: () => void log.push(`start:${name}`),
  stop: () => void log.push(`stop:${name}`),
});

const failing = (name: string, log: string[]): Service => ({
  name,
  start: () => Promise.reject(new Error("Refusing to start: cannot reach SOLANA_RPC_URL.")),
  stop: () => void log.push(`stop:${name}`),
});

/** process.exit must not end the test run. */
function exitSpy() {
  const codes: number[] = [];
  const exit = (code: number): void => void codes.push(code);
  return { codes, exit };
}

describe("runProcess", () => {
  it("starts the services in order", async () => {
    const log: string[] = [];
    const { exit, codes } = exitSpy();

    await runProcess([trace("bot", log), trace("api", log)], { exit });

    expect(log).toEqual(["start:bot", "start:api"]);
    expect(codes).toEqual([]);
  });

  it("stops what already started, runs the hook and exits 1 when a start fails", async () => {
    const log: string[] = [];
    const { exit, codes } = exitSpy();
    const onShutdown = vi.fn();

    await runProcess([trace("bot", log), failing("worker", log)], { exit, onShutdown });

    // The failing service never started, so it is not stopped.
    expect(log).toEqual(["start:bot", "stop:bot"]);
    expect(onShutdown).toHaveBeenCalledOnce();
    expect(codes).toEqual([1]);
  });

  it("keeps stopping the other services when one fails to stop", async () => {
    const log: string[] = [];
    const { exit } = exitSpy();
    const stubborn: Service = {
      name: "api",
      start: () => void log.push("start:api"),
      stop: () => Promise.reject(new Error("still draining")),
    };

    await runProcess([trace("bot", log), stubborn, failing("worker", log)], { exit });

    expect(log).toEqual(["start:bot", "start:api", "stop:bot"]);
  });

  it("stops the services in reverse order on SIGINT, then runs the hook", async () => {
    const log: string[] = [];
    const { exit, codes } = exitSpy();
    const onShutdown = vi.fn(() => void log.push("shutdown"));

    await runProcess([trace("bot", log), trace("api", log)], { exit, onShutdown });
    events.emit("SIGINT");
    await vi.waitFor(() => expect(codes).toEqual([0]));

    expect(log).toEqual(["start:bot", "start:api", "stop:api", "stop:bot", "shutdown"]);
  });

  it("ignores a second signal while it is already shutting down", async () => {
    const log: string[] = [];
    const { exit, codes } = exitSpy();

    await runProcess([trace("bot", log)], { exit });
    events.emit("SIGINT");
    events.emit("SIGTERM");
    await vi.waitFor(() => expect(codes).toEqual([0]));

    expect(log).toEqual(["start:bot", "stop:bot"]);
  });
});

describe("scrubError", () => {
  it("keeps the name and the scrubbed message, never the stack", () => {
    const error = new Error("getMe failed");
    error.name = "GrammyError";

    const scrubbed = scrubError(error);

    expect(Object.keys(scrubbed)).toEqual(["name", "message"]);
    expect(scrubbed.name).toBe("GrammyError");
  });

  it("accepts a rejection that is not an Error", () => {
    expect(scrubError("boom")).toEqual({ name: "Error", message: "boom" });
    expect(scrubError(undefined)).toEqual({ name: "Error", message: "undefined" });
  });
});
