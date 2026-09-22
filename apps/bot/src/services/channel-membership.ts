import { setChannelCheckedAt } from "@launchbot/db";
import type { PrismaClient, User } from "@launchbot/db";
import { CACHE_TTL_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Api } from "grammy";
import type { ChatMember } from "grammy/types";
import { readTimeout } from "./telegram-timeout.js";

const log = createLogger("bot:membership");

/** `cached` trusts a positive check for 10 min (every /start); `fresh` always asks Telegram. */
export type MembershipMode = "cached" | "fresh";
export type MembershipStatus = "member" | "not_member" | "error";

export type MembershipCheck = {
  status: MembershipStatus;
  /** `User.channelCheckedAt` as it now stands in the database. */
  channelCheckedAt: Date | null;
};

/** §4.2: `restricted` counts only while the user is still in the channel. */
export function isMemberStatus(member: ChatMember): boolean {
  switch (member.status) {
    case "creator":
    case "administrator":
    case "member":
      return true;
    case "restricted":
      return member.is_member;
    default:
      return false;
  }
}

export type ChannelMembershipDeps = {
  api: Pick<Api, "getChatMember">;
  prisma: PrismaClient;
  channelId: string;
  now?: () => number;
};

/**
 * Membership of the channel of the bot, without any UI (§4.2). `User.channelCheckedAt` is the
 * date of the last positive check: a member gets the current date, a non-member gets `null`,
 * and a failed check leaves it as it was.
 */
export function createMembershipCheck(deps: ChannelMembershipDeps) {
  const { api, prisma, channelId, now = Date.now } = deps;

  return async (
    user: Pick<User, "id" | "telegramId" | "channelCheckedAt">,
    mode: MembershipMode,
  ): Promise<MembershipCheck> => {
    const checkedAt = user.channelCheckedAt;
    if (
      mode === "cached" &&
      checkedAt !== null &&
      now() - checkedAt.getTime() < CACHE_TTL_MS.channelMembership
    ) {
      return { status: "member", channelCheckedAt: checkedAt };
    }

    let isMember: boolean;
    try {
      // The bot must administer the channel, or Telegram hides its member list (§3).
      const member = await api.getChatMember(channelId, Number(user.telegramId), readTimeout());
      isMember = isMemberStatus(member);
    } catch (error) {
      // Fails closed. Nothing about the user is logged.
      log.error({ err: error }, "Channel membership check failed");
      return { status: "error", channelCheckedAt: checkedAt };
    }

    const channelCheckedAt = isMember ? new Date(now()) : null;
    // A click of someone who still has not joined has nothing to write.
    if (isMember || checkedAt !== null)
      await setChannelCheckedAt(prisma, user.id, channelCheckedAt);
    return { status: isMember ? "member" : "not_member", channelCheckedAt };
  };
}
