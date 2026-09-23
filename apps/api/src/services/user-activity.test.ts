import type { PrismaClient } from "@launchbot/db";
import { MINUTE_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUserActivity } from "./user-activity.js";

const T0 = Date.parse("2026-09-23T12:00:00Z");
const user = (id: number) => ({ id, firstName: "Tristan" });

function harness() {
  let time = T0;
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { user: { updateMany } } as unknown as PrismaClient;
  const touch = createUserActivity({ prisma, now: () => time });
  return { touch, updateMany, at: (ms: number) => void (time = T0 + ms) };
}

afterEach(() => setLogDestination(undefined));

describe("createUserActivity", () => {
  it("writes lastActiveAt of the account of the Telegram id, never creating one", async () => {
    const { touch, updateMany } = harness();

    await touch(user(5_000_000_001));

    expect(updateMany).toHaveBeenCalledWith({
      where: { telegramId: 5_000_000_001n },
      data: { lastActiveAt: new Date(T0) },
    });
  });

  it("writes once per minute per user", async () => {
    const { touch, updateMany, at } = harness();

    await touch(user(1));
    at(MINUTE_MS - 1);
    await touch(user(1));
    await touch(user(2));
    expect(updateMany).toHaveBeenCalledTimes(2);

    at(MINUTE_MS);
    await touch(user(1));
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it("logs a failed write and lets the request go on", async () => {
    const lines = captureLogs();
    const { touch, updateMany } = harness();
    updateMany.mockRejectedValueOnce(new Error("connection lost"));

    await expect(touch(user(1))).resolves.toBeUndefined();
    expect(lines.join("")).toContain("User activity not recorded");

    // A failed write is not kept: the next request tries again.
    await touch(user(1));
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
