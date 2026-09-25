import type { SubscriptionService, User } from "@launchbot/db";
import { ADMIN_CONFIRM_TTL_MS, E, en, GRANT_NOTIFY_USER, parseOfferCode } from "@launchbot/shared";
import type { Offer } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext } from "../../context.js";
import { newNonce } from "../../navigation/confirm-token.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowMode } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import { renderAdminNotice, renderAdminUserNotFound, tellUser } from "./common.js";
import type { AdminKit } from "./common.js";
import {
  buildGrantConfirmScreen,
  buildGrantNoticeScreen,
  buildGrantResultScreen,
  grantArgsSchema,
} from "./grant-screens.js";

const log = createLogger("bot:admin:grant");

export type GrantDeps = {
  kit: AdminKit;
  /** The domain of V1-27: the preview and the activation, never computed here. */
  subscriptions: Pick<SubscriptionService, "previewGrant" | "confirmGrant" | "isGrantUsed">;
  findUserById: (userId: string) => Promise<User | null>;
  now: () => Date;
};

/** `/grant` and its buttons `adm:grant:ok|no:<nonce>` (§11.4, V1-42). */
export function createGrant(deps: GrantDeps): {
  command: (ctx: BotContext) => Promise<unknown>;
  callback: CallbackHandler;
} {
  const { kit, subscriptions, findUserById, now } = deps;
  const { ui } = kit;

  /** The confirmation, with a new nonce: the one Confirm the session will accept. */
  async function showConfirm(ctx: BotContext, user: User, offer: Offer, mode: ShowMode) {
    const at = now();
    const preview = await subscriptions.previewGrant(user.id, offer, at);
    const nonce = newNonce(8);
    ctx.session.adminGrant = {
      nonce,
      targetUserId: user.id,
      targetTelegramId: user.telegramId.toString(),
      offerCode: offer.code,
      kind: preview.computed.kind,
      currentExpiresAt:
        preview.status.kind === "ACTIVE" ? preview.status.subscription.expiresAt.getTime() : null,
      createdAt: at.getTime(),
    };
    return showScreen(ctx, buildGrantConfirmScreen(ui, { user, offer, preview, now: at, nonce }), {
      mode,
    });
  }

  async function confirm(ctx: BotContext, nonce: string): Promise<unknown> {
    // The guard in the database first: the Confirm of a screen already used writes nothing.
    if (await subscriptions.isGrantUsed(nonce)) {
      return notify(ctx, en.admin.grant.used, { alert: true });
    }
    const state = ctx.session.adminGrant;
    const at = now();
    const offer = state === undefined ? null : parseOfferCode(state.offerCode);
    if (
      state?.nonce !== nonce ||
      offer === null ||
      at.getTime() - state.createdAt >= ADMIN_CONFIRM_TTL_MS
    ) {
      if (state?.nonce === nonce) delete ctx.session.adminGrant;
      await notify(ctx, en.admin.grant.expired, { alert: true });
      return showScreen(
        ctx,
        renderAdminNotice(ui, "grant", `${E.expired} ${en.admin.grant.expired}`),
      );
    }

    const result = await subscriptions.confirmGrant({
      userId: state.targetUserId,
      offer,
      now: at,
      actorTelegramId: ctx.user.telegramId,
      nonce,
      expected: {
        kind: state.kind,
        currentExpiresAt: state.currentExpiresAt === null ? null : new Date(state.currentExpiresAt),
      },
    });
    if (result.status === "USED") return notify(ctx, en.admin.grant.used, { alert: true });

    const user = await findUserById(state.targetUserId);
    if (result.status === "USER_DELETED" || user === null) {
      delete ctx.session.adminGrant;
      return showScreen(ctx, renderAdminUserNotFound(ui, "grant", state.targetTelegramId));
    }
    if (result.status !== "ACTIVATED") {
      // CHANGED, or REFUSED by a race: nothing was activated, the screen says the plan of now.
      await notify(ctx, en.admin.grant.changed, { alert: true });
      return showConfirm(ctx, user, offer, "auto");
    }

    delete ctx.session.adminGrant;
    const { expiresAt } = result.subscription;
    // Proposal (V1-42): the user hears it the way « Payment received » says it.
    const notified = GRANT_NOTIFY_USER
      ? await tellUser(
          ctx,
          user,
          buildGrantNoticeScreen(ui, result.subscription.plan, expiresAt),
          "admin.grant.not_notified",
        )
      : undefined;
    log.info(
      {
        adminTelegramId: ctx.user.telegramId.toString(),
        userId: user.id,
        plan: offer.plan,
        duration: offer.duration,
        kind: result.kind,
        expiresAt,
      },
      "admin.grant",
    );
    return showScreen(ctx, buildGrantResultScreen(ui, { user, offer, expiresAt, notified }));
  }

  return {
    async command(ctx) {
      const args = await kit.parseArgs(ctx, "grant", grantArgsSchema);
      if (args === null) return;
      // The letter of a code is ignored: the plan is read again (V1-40).
      const user = await kit.resolveUserRef(args.ref);
      if (user === null) return kit.replyNotFound(ctx, "grant", args.query);
      return showConfirm(ctx, user, args.offer, "new");
    },

    callback(ctx, [action, nonce]) {
      if (nonce === undefined) return notify(ctx, en.common.staleButton);
      if (action === "ok") return confirm(ctx, nonce);
      if (action !== "no") return notify(ctx, en.common.staleButton);
      // Cancel writes nothing: the nonce leaves the session, the message says so.
      if (ctx.session.adminGrant?.nonce === nonce) delete ctx.session.adminGrant;
      return showScreen(ctx, renderAdminNotice(ui, "grant", en.admin.grant.canceled));
    },
  };
}
