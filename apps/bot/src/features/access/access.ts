import type { PrismaClient } from "@launchbot/db";
import { decodeCallback, en } from "@launchbot/shared";
import type { CallbackDomain, Ui } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";
import type { Api, MiddlewareFn } from "grammy";
import type { BotContext } from "../../context.js";
import { tooManyActions } from "../../middleware/rate-limit.js";
import { blockWithFlag, showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowMode } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import { createMembershipCheck } from "../../services/channel-membership.js";
import type { MembershipMode, MembershipStatus } from "../../services/channel-membership.js";
import { buildChannelScreen, joinedCallback } from "./screens.js";

/** The button of the gate itself: the gate lets it through, this feature handles it. */
const DOMAIN: CallbackDomain = "acc";

export type AccessEnv = Pick<Env, "CHANNEL_BOT_ID" | "CHANNEL_BOT_URL">;

export type AccessDeps = {
  env: AccessEnv;
  prisma: PrismaClient;
  api: Pick<Api, "getChatMember">;
  ui: Ui;
};

export type ResumeHandler = (ctx: BotContext) => Promise<unknown>;

export type EnsureMembershipOptions = {
  mode: MembershipMode;
  /**
   * Where "I've joined" takes the user back to. `launch` also makes the screen say why it
   * interrupts: `🚀 Join the channel to launch a coin.`
   */
  resume: string;
  /** `new`: a new message (a /start). By default a click edits the screen it comes from. */
  display?: ShowMode;
};

export type Access = {
  /**
   * No menu before the channel is joined (§4.2). Goes before the conversations and every
   * router; admin commands (V1-38) are registered after it.
   */
  gate: MiddlewareFn<BotContext>;
  /** `true`: the user is in the channel, carry on. `false`: the channel screen is shown, stop. */
  ensureChannelMembership: (ctx: BotContext, options: EnsureMembershipOptions) => Promise<boolean>;
  /** The flow "I've joined" resumes. It shows its screen with `showScreen`: a click edits. */
  registerResume: (key: string, handler: ResumeHandler) => void;
  /** Takes the `acc` domain: "I've joined". */
  register: (router: CallbackRouter) => void;
};

export function createAccess({ env, prisma, api, ui }: AccessDeps): Access {
  const check = createMembershipCheck({ api, prisma, channelId: env.CHANNEL_BOT_ID });
  const resumes = new Map<string, ResumeHandler>();

  async function showChannel(ctx: BotContext, resume: string, mode?: ShowMode): Promise<void> {
    await showScreen(ctx, buildChannelScreen(ui, env, { resume }), { mode });
  }

  /** `ctx.user` follows what the check wrote, for whatever reads it later in the update. */
  async function checkMembership(ctx: BotContext, mode: MembershipMode): Promise<MembershipStatus> {
    const { status, channelCheckedAt } = await check(ctx.user, mode);
    ctx.user = { ...ctx.user, channelCheckedAt };
    return status;
  }

  async function resume(ctx: BotContext, key: string): Promise<void> {
    // A key from an old button, or from a flow that no longer exists, goes home.
    const handler = resumes.get(key) ?? resumes.get("home");
    if (handler === undefined) throw new Error('No "home" resume target is registered');
    await handler(ctx);
  }

  async function onJoined(ctx: BotContext, [key = "home"]: string[]): Promise<void> {
    const block = (pair: Block) =>
      blockWithFlag(ctx, pair, (flag) => buildChannelScreen(ui, env, { resume: key, flag }));

    const verdict = consumeRateLimit(Number(ctx.user.telegramId), "channelCheck");
    if (!verdict.ok) return block(tooManyActions(verdict.retryAfterMs));

    const status = await checkMembership(ctx, "fresh");
    if (status === "member") return resume(ctx, key);
    await block(status === "error" ? en.access.channel.checkFailed : en.access.channel.notJoined);
  }

  return {
    gate: async (ctx, next) => {
      // Other update types (my_chat_member…) show no screen: the gate has nothing to hide.
      if (ctx.message === undefined && ctx.callbackQuery === undefined) return next();
      // Its own button, or nobody could ever get through it.
      const data = ctx.callbackQuery?.data;
      if (data !== undefined && decodeCallback(data)?.domain === DOMAIN) return next();

      // Proposal: checked on every interaction, not only on /start. `ctx.user` is already
      // loaded by `userActivity`, so it costs nothing.
      if (ctx.user.channelCheckedAt === null) return showChannel(ctx, "home");
      await next();
    },

    async ensureChannelMembership(ctx, { mode, resume: key, display }) {
      if ((await checkMembership(ctx, mode)) === "member") return true;
      // A failed check shows the same screen: it fails closed, and "I've joined" retries it.
      await showChannel(ctx, key, display);
      return false;
    },

    registerResume(key, handler) {
      // Throws at startup for a key that would not fit in the callback data of the button.
      joinedCallback(key);
      resumes.set(key, handler);
    },

    register: (router) => router.register(DOMAIN, { join: onJoined }),
  };
}
