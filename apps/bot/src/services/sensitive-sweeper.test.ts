import type { SensitiveMessage, SensitiveMessageStore } from "@launchbot/db";
import { SENSITIVE_MESSAGE_TTL_MS, SENSITIVE_SWEEP_INTERVAL_MS } from "@launchbot/shared";
import { captureLogs, runEvery, setLogDestination } from "@launchbot/shared/server";
import { GrammyError, HttpError } from "grammy";
import type { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweepSensitiveMessages } from "./sensitive-sweeper.js";

afterEach(() => {
  vi.useRealTimers();
  setLogDestination(undefined);
});

/** The table in memory: what the store of @launchbot/db does, due rows first. */
function memoryStore(rows: SensitiveMessage[] = []) {
  const store: Pick<SensitiveMessageStore, "listDue" | "remove" | "retryLater" | "schedule"> = {
    schedule: (chatId, messageId, deleteAt) => {
      rows.push({ id: `r${rows.length + 1}`, chatId, messageId, deleteAt, attempts: 0 });
      return Promise.resolve();
    },
    listDue: (now, limit) =>
      Promise.resolve(
        rows
          .filter((row) => row.deleteAt <= now)
          .sort((a, b) => a.deleteAt.getTime() - b.deleteAt.getTime())
          .slice(0, limit),
      ),
    remove: (id) => {
      rows.splice(
        rows.findIndex((row) => row.id === id),
        1,
      );
      return Promise.resolve();
    },
    retryLater: (id) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row !== undefined) row.attempts += 1;
      return Promise.resolve();
    },
  };
  return { store, rows };
}

const badRequest = (description: string, code = 400) =>
  new GrammyError(
    `Call to 'deleteMessage' failed!`,
    { ok: false, error_code: code, description },
    "deleteMessage",
    {},
  );

function fakeApi(...failures: Error[]) {
  const deleteMessage = vi.fn<Api["deleteMessage"]>(() => {
    const failure = failures.shift();
    return failure === undefined ? Promise.resolve(true) : Promise.reject(failure);
  });
  const sendMessage = vi.fn<Api["sendMessage"]>(() => Promise.resolve({} as never));
  return { api: { deleteMessage, sendMessage }, deleteMessage, sendMessage };
}

const due = (messageId: number, deleteAt = new Date(0)): SensitiveMessage => ({
  id: `m${messageId}`,
  chatId: 777n,
  messageId,
  deleteAt,
  attempts: 0,
});

describe("sweepSensitiveMessages (V1-43)", () => {
  it("deletes the messages due, and only them", async () => {
    const { store, rows } = memoryStore([due(1), due(2, new Date(Date.now() + 60_000))]);
    const { api, deleteMessage } = fakeApi();

    expect(await sweepSensitiveMessages({ store, api })).toEqual({
      deleted: 1,
      undeletable: 0,
      retried: 0,
    });

    expect(deleteMessage).toHaveBeenCalledWith("777", 1);
    expect(rows.map((row) => row.messageId)).toEqual([2]);
  });

  it("forgets a message already gone", async () => {
    const { store, rows } = memoryStore([due(1)]);
    const { api, sendMessage } = fakeApi(badRequest("Bad Request: message to delete not found"));

    await sweepSensitiveMessages({ store, api });

    expect(rows).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("asks the admin to delete by hand a message it can no longer delete", async () => {
    const logs = captureLogs();
    const { store, rows } = memoryStore([due(1), due(2)]);
    const { api, sendMessage } = fakeApi(
      badRequest("Bad Request: message can't be deleted"),
      badRequest("Forbidden: bot was blocked by the user", 403),
    );

    expect(await sweepSensitiveMessages({ store, api })).toEqual({
      deleted: 0,
      undeletable: 2,
      retried: 0,
    });

    expect(rows).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith(
      "777",
      "⚠️ Couldn't delete this message with wallet keys. Delete it yourself now.",
      { reply_parameters: { message_id: 1, allow_sending_without_reply: true } },
    );
    expect(logs.join("")).toContain("sensitive.not_deleted");
    expect(logs.join("")).not.toContain("payload");
  });

  it("tries again after a network error or a 5xx, waits after a 429", async () => {
    captureLogs();
    const { store, rows } = memoryStore([due(1), due(2), due(3)]);
    const { api } = fakeApi(
      new HttpError("Network request for 'deleteMessage' failed!", new Error("ECONNRESET")),
      badRequest("Internal Server Error", 500),
      badRequest("Too Many Requests: retry after 30", 429),
    );

    expect(await sweepSensitiveMessages({ store, api })).toEqual({
      deleted: 0,
      undeletable: 0,
      retried: 2,
    });

    expect(rows.map((row) => [row.messageId, row.attempts])).toEqual([
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
  });

  it("with the loop of the bot: nothing before 60 s, deleted before 65 s", async () => {
    vi.useFakeTimers();
    const { store, rows } = memoryStore();
    const { api, deleteMessage } = fakeApi();
    await store.schedule(777n, 42, new Date(Date.now() + SENSITIVE_MESSAGE_TTL_MS));
    const loop = runEvery({
      name: "sensitive-messages",
      intervalMs: SENSITIVE_SWEEP_INTERVAL_MS,
      run: async () => {
        await sweepSensitiveMessages({ store, api });
      },
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(deleteMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(deleteMessage).toHaveBeenCalledWith("777", 42);
    expect(rows).toEqual([]);

    await loop.stop();
  });
});
