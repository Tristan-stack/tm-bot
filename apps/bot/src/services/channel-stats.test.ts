import { MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import type { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramError } from "../test-harness.js";
import { createChannelMemberCounter } from "./channel-stats.js";

const CHANNEL_ID = "-1001000000001";

function harness() {
  let time = Date.parse("2026-09-21T12:00:00Z");
  const lines = captureLogs();
  const getChatMemberCount = vi.fn<Api["getChatMemberCount"]>();
  const count = createChannelMemberCounter({
    api: { getChatMemberCount },
    channelId: CHANNEL_ID,
    now: () => time,
  });
  return { count, getChatMemberCount, lines, advance: (ms: number) => void (time += ms) };
}

const DOWN = telegramError("getChatMemberCount", "Bad Request: chat not found");

afterEach(() => {
  setLogDestination(undefined);
});

describe("createChannelMemberCounter", () => {
  it("asks Telegram once per 10 min", async () => {
    const { count, getChatMemberCount, advance } = harness();
    getChatMemberCount.mockResolvedValueOnce(1200).mockResolvedValueOnce(1250);

    expect(await count()).toBe(1200);
    advance(10 * MINUTE_MS - SECOND_MS);
    expect(await count()).toBe(1200);
    // With a timeout: a read that hangs would stall every user.
    expect(getChatMemberCount).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, expect.any(AbortSignal));

    advance(SECOND_MS);
    expect(await count()).toBe(1250);
  });

  it("returns null, with a warning, when the first call fails", async () => {
    const { count, getChatMemberCount, lines } = harness();
    getChatMemberCount.mockRejectedValueOnce(DOWN);

    expect(await count()).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":40');
  });

  it("asks a failing Telegram again after a minute, not on every home screen", async () => {
    const { count, getChatMemberCount, lines, advance } = harness();
    getChatMemberCount.mockRejectedValue(DOWN);

    await count();
    advance(MINUTE_MS - SECOND_MS);
    await count();
    expect(getChatMemberCount).toHaveBeenCalledOnce();
    expect(lines).toHaveLength(1);

    advance(SECOND_MS);
    await count();
    expect(getChatMemberCount).toHaveBeenCalledTimes(2);
  });

  it("serves the last known count, however old, when Telegram fails", async () => {
    const { count, getChatMemberCount, advance } = harness();
    getChatMemberCount.mockResolvedValueOnce(1200).mockRejectedValue(DOWN);
    await count();
    advance(24 * 60 * MINUTE_MS);

    expect(await count()).toBe(1200);
  });
});
