import { describe, expect, it } from "vitest";
import { initialSession, isSessionData, SESSION_VERSION } from "./context.js";
import { createSessionStorage } from "./middleware/session.js";
import { createBot } from "./index.js";
import {
  callbackUpdate,
  fakeData,
  fakePrisma,
  feed,
  interceptApi,
  storedSession,
  TEST_ENV,
} from "./test-harness.js";

const CHAT_KEY = "777";

describe("session data", () => {
  it("starts at the current version with no screen", () => {
    expect(initialSession()).toEqual({ v: SESSION_VERSION });
  });

  it.each([
    ["the current shape", { v: SESSION_VERSION }, true],
    ["a known screen", { v: SESSION_VERSION, screenMessageId: 42 }, true],
    ["an unknown version", { v: 99, screenMessageId: 42 }, false],
    ["no version", { screenMessageId: 42 }, false],
    ["a screen id of the wrong type", { v: SESSION_VERSION, screenMessageId: "42" }, false],
    [
      "a pending rename",
      { v: SESSION_VERSION, pendingInput: { kind: "wallet_rename", walletId: "w1" } },
      true,
    ],
    [
      "a pending input of an unknown kind",
      { v: SESSION_VERSION, pendingInput: { kind: "x" } },
      false,
    ],
    ["null", null, false],
    ["a string", "session", false],
  ])("accepts %s: %j", (_label, value, expected) => {
    expect(isSessionData(value)).toBe(expected);
  });
});

describe("session storage", () => {
  it("returns undefined for a chat it never saw", async () => {
    expect(await createSessionStorage(fakePrisma()).read("unknown")).toBeUndefined();
  });

  it("drops a row this version cannot read instead of failing every update", async () => {
    const prisma = fakePrisma({
      sessions: new Map([
        ["corrupt", "{not json"],
        ["old", JSON.stringify({ v: 0, wallets: [] })],
      ]),
    });
    const storage = createSessionStorage(prisma);

    expect(await storage.read("corrupt")).toBeUndefined();
    expect(await storage.read("old")).toBeUndefined();
  });

  it("skips the write when the session did not change", async () => {
    const rows = new Map([[CHAT_KEY, JSON.stringify({ v: 1, screenMessageId: 42 })]]);
    const storage = createSessionStorage(fakePrisma({ sessions: rows }));

    const session = await storage.read(CHAT_KEY);
    if (session === undefined) throw new Error("the session was expected to exist");
    // A marker in the row: a write would replace it.
    rows.set(CHAT_KEY, "untouched");
    await storage.write(CHAT_KEY, session);
    expect(rows.get(CHAT_KEY)).toBe("untouched");

    session.screenMessageId = 43;
    await storage.write(CHAT_KEY, session);
    expect(rows.get(CHAT_KEY)).toBe(JSON.stringify({ v: 1, screenMessageId: 43 }));
  });

  it("survives a restart of the bot: the row a run wrote is read back by the next", async () => {
    const sessions = new Map<string, string>();
    const first = fakePrisma({ sessions });
    const bot = createBot(TEST_ENV, first, { data: fakeData() });
    interceptApi(bot);

    await feed(bot, callbackUpdate("home:refresh", { messageId: 55 }));
    expect(storedSession(first)).toEqual({ v: 1, screenMessageId: 55 });

    // A new process over the same table, with its own client, reads the same session.
    const second = createSessionStorage(fakePrisma({ sessions }));
    expect(await second.read(CHAT_KEY)).toEqual({ v: 1, screenMessageId: 55 });
  });
});
