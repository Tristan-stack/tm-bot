import type { PrismaClient } from "@launchbot/db";
import { CACHE_TTL_MS, SECOND_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import type { ChatMember } from "grammy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatMember, telegramError } from "../test-harness.js";
import { createMembershipCheck, isMemberStatus } from "./channel-membership.js";

describe("isMemberStatus", () => {
  it.each(["creator", "administrator", "member"])("accepts %s", (status) => {
    expect(isMemberStatus(chatMember(status))).toBe(true);
  });

  it("accepts restricted only while the user is still in the channel", () => {
    expect(isMemberStatus(chatMember("restricted", { is_member: true }))).toBe(true);
    expect(isMemberStatus(chatMember("restricted", { is_member: false }))).toBe(false);
  });

  it.each(["left", "kicked", "something_new"])("refuses %s", (status) => {
    expect(isMemberStatus(chatMember(status))).toBe(false);
  });
});

const NOW = new Date("2026-09-21T12:00:00Z");
const CHANNEL_ID = "-1001000000001";
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function harness(reply: ChatMember | Error = chatMember("member")) {
  const getChatMember = vi.fn(() =>
    reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply),
  );
  const update = vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve(args.data),
  );
  const check = createMembershipCheck({
    api: { getChatMember },
    prisma: { user: { update } } as unknown as PrismaClient,
    channelId: CHANNEL_ID,
    now: () => NOW.getTime(),
  });
  return { check, getChatMember, update };
}

const user = (channelCheckedAt: Date | null) => ({
  id: "u1",
  telegramId: 123456789n,
  channelCheckedAt,
});

afterEach(() => {
  setLogDestination(undefined);
});

describe("createMembershipCheck", () => {
  it("trusts a positive check for 9 min 59 s without calling Telegram", async () => {
    const { check, getChatMember, update } = harness(chatMember("left"));
    const checkedAt = ago(CACHE_TTL_MS.channelMembership - SECOND_MS);

    expect(await check(user(checkedAt), "cached")).toEqual({
      status: "member",
      channelCheckedAt: checkedAt,
    });
    expect(getChatMember).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("asks Telegram again once the check is 10 min old", async () => {
    const { check, getChatMember } = harness();

    await check(user(ago(CACHE_TTL_MS.channelMembership)), "cached");

    // BigInt in the database, number for the Bot API; and a timeout, so a read that hangs
    // cannot stall every user.
    expect(getChatMember).toHaveBeenCalledExactlyOnceWith(
      CHANNEL_ID,
      123456789,
      expect.any(AbortSignal),
    );
  });

  it("asks Telegram when the channel was never checked", async () => {
    const { check, getChatMember } = harness();

    await check(user(null), "cached");

    expect(getChatMember).toHaveBeenCalledOnce();
  });

  it("always asks Telegram in fresh mode", async () => {
    const { check, getChatMember } = harness();

    await check(user(ago(SECOND_MS)), "fresh");

    expect(getChatMember).toHaveBeenCalledOnce();
  });

  it("records the date of a positive check, and returns it", async () => {
    const { check, update } = harness(chatMember("administrator"));

    expect(await check(user(null), "fresh")).toEqual({ status: "member", channelCheckedAt: NOW });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "u1" },
      data: { channelCheckedAt: NOW },
    });
  });

  it("erases the date when the user is not in the channel", async () => {
    const { check, update } = harness(chatMember("left"));

    expect(await check(user(ago(SECOND_MS)), "fresh")).toEqual({
      status: "not_member",
      channelCheckedAt: null,
    });
    expect(update.mock.calls[0]?.[0].data).toEqual({ channelCheckedAt: null });
  });

  it("writes nothing for someone who still has not joined", async () => {
    const { check, update } = harness(chatMember("left"));

    expect((await check(user(null), "fresh")).status).toBe("not_member");
    expect(update).not.toHaveBeenCalled();
  });

  it("fails closed on a Telegram error, leaves the date alone and logs no user data", async () => {
    const lines = captureLogs();
    const checkedAt = ago(SECOND_MS);
    const { check, update } = harness(
      telegramError("getChatMember", "Bad Request: member list is inaccessible"),
    );

    expect(await check(user(checkedAt), "fresh")).toEqual({
      status: "error",
      channelCheckedAt: checkedAt,
    });
    expect(update).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":50');
    expect(lines[0]).toContain("member list is inaccessible");
    expect(lines[0]).not.toContain("123456789");
  });
});
