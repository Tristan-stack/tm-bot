import {
  CACHE_TTL_MS,
  computeActivation,
  createTtlCache,
  getOffer,
  getPlanFeatures,
  isPaid,
  PAYMENT_STATUSES,
} from "@launchbot/shared";
import type {
  ActivationKind,
  ActivationMode,
  ComputedActivation,
  Offer,
  PlanFeatures,
  PlanStatus,
} from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Db } from "../client.js";
import { isUniqueViolation } from "../errors.js";
import type {
  GrantKind,
  PaymentStatus,
  Plan,
  PlanDuration,
  PrismaClient,
  Subscription,
} from "../generated/prisma/client.js";
import { MANAGED_WALLET } from "./balances.js";
import { lockUserRow } from "./user.js";

// The subscription domain on the database side (§8, V1-27). Reads are never cached (except the
// counter): an activation must show at once. The rules themselves are pure, in
// @launchbot/shared (`decidePurchase`, `computeActivation`).

const log = createLogger("db:subscriptions");

export type SubscriptionInfo = Pick<
  Subscription,
  "id" | "plan" | "duration" | "startsAt" | "expiresAt"
>;

const INFO = { id: true, plan: true, duration: true, startsAt: true, expiresAt: true } as const;

/**
 * "Active" everywhere: `status = ACTIVE` and `expiresAt > now`. The date covers an expiry job
 * (V1-34) that runs late. A partial unique index keeps at most one ACTIVE row per user.
 */
const isActive = (now: Date) => ({ status: "ACTIVE", expiresAt: { gt: now } }) as const;
/** ACTIVE rows whose end has passed: the expiry job and the activation turn them EXPIRED. */
const isDue = (now: Date) => ({ status: "ACTIVE", expiresAt: { lte: now } }) as const;

export function getActiveSubscription(
  prisma: Db,
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionInfo | null> {
  return prisma.subscription.findFirst({ where: { userId, ...isActive(now) }, select: INFO });
}

/** What the active plan unlocks (§8.1): the gates below read it, never the plan itself. */
async function activeFeatures(prisma: Db, userId: string, now: Date): Promise<PlanFeatures> {
  return getPlanFeatures((await getActiveSubscription(prisma, userId, now))?.plan ?? null);
}

/** Launch Coin needs an active plan (§8, D2): the entry of the flow (V1-35). */
export async function hasActiveSubscription(
  prisma: Db,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await activeFeatures(prisma, userId, now)).launchCoin;
}

/** AI Generate is Premium only (§5, §8.1): V1-16 reads it for the button, V1-17 on the click. */
export async function hasActivePremium(
  prisma: Db,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await activeFeatures(prisma, userId, now)).aiGenerate;
}

/**
 * The plan of a user (§4.3, §8.2) in one read: the row that ends last. With one ACTIVE row per
 * user at most, and every EXPIRED row ended when it was expired, that row is the active
 * subscription when there is one, else the one that ended last (« Classic ⚠️ expired »).
 */
export async function getPlanStatus(
  prisma: Db,
  userId: string,
  now: Date = new Date(),
): Promise<PlanStatus> {
  const latest = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { expiresAt: "desc" },
    select: { ...INFO, status: true },
  });
  if (latest === null) return { kind: "NONE" };
  const { status, ...subscription } = latest;
  const active = status === "ACTIVE" && subscription.expiresAt > now;
  return { kind: active ? "ACTIVE" : "EXPIRED", subscription };
}

export type WalletQuota = {
  /** Can exceed `limit`: wallets are kept after an expiry or a downgrade (§8.1). */
  count: number;
  limit: number;
  reached: boolean;
};

export async function getWalletQuota(
  prisma: Db,
  userId: string,
  now: Date = new Date(),
): Promise<WalletQuota> {
  const [count, features] = await Promise.all([
    // A launch wallet is outside the limit of the plan (decision of 26/09/2026).
    prisma.wallet.count({ where: { userId, ...MANAGED_WALLET } }),
    activeFeatures(prisma, userId, now),
  ]);
  return { count, limit: features.maxWallets, reached: count >= features.maxWallets };
}

/**
 * The counter of the home screen (§4.3), cached 60 s for everyone. One ACTIVE row per user at
 * most: active rows are subscribers.
 */
export function createActiveSubscriberCounter(deps: {
  prisma: PrismaClient;
  now?: () => number;
}): () => Promise<number> {
  const { prisma, now = Date.now } = deps;
  const cache = createTtlCache<"count", number>({ ttlMs: CACHE_TTL_MS.activeSubscribers, now });
  return () =>
    cache.get("count", () => prisma.subscription.count({ where: isActive(new Date(now())) }));
}

type Activated = { status: "ACTIVATED"; kind: ActivationKind; subscription: SubscriptionInfo };

export type ActivationResult =
  | Activated
  /** Another caller activated this invoice first: nothing was written. */
  | { status: "ALREADY_ACTIVATED" }
  /** The account was purged (`Payment.userId` null): nothing is activated, refund by hand. */
  | { status: "USER_DELETED" };

/** `REFUSED`: Classic during Premium (§8.4). */
export type GrantResult = Activated | { status: "REFUSED" } | { status: "USER_DELETED" };

export type GrantInput = { userId: string; offer: Offer; now: Date; actorTelegramId: bigint };

/** What a /grant would do now (V1-42): the plan its confirmation shows, and what it becomes. */
export type GrantPreview = { status: PlanStatus; computed: ComputedActivation };

/** What the confirmation screen showed: its Confirm activates only while the plan is still that. */
export type GrantExpectation = {
  kind: ComputedActivation["kind"];
  /** The end an extension builds on (EXTEND): a payment since has moved it. */
  currentExpiresAt: Date | null;
};

export type GrantConfirmation =
  | GrantResult
  /** This Confirm already activated a plan: its nonce has a row. */
  | { status: "USED" }
  /** The plan is no longer the one the screen showed (a payment, another grant). */
  | { status: "CHANGED" };

export type ExpiredSubscription = Pick<Subscription, "id" | "userId" | "plan">;

export type SubscriptionService = {
  /**
   * The only code that turns an invoice PAID (§8.3: once per invoice). The caller (V1-28) has
   * checked the amount received and the 24 h window. With `tx`, runs inside the caller's
   * transaction (V1-28 writes `receivedLamports` in the same one).
   */
  activateFromPayment: (paymentId: string, now: Date, tx?: Db) => Promise<ActivationResult>;
  /** /grant (§11.4, V1-42): the rules of a purchase, without an invoice. */
  grantSubscription: (input: GrantInput) => Promise<GrantResult>;
  /**
   * What a /grant would do, written nowhere: the confirmation screen of V1-42, from one read of
   * the plan, so its « Current plan » and its variant never disagree.
   */
  previewGrant: (userId: string, offer: Offer, now: Date) => Promise<GrantPreview>;
  /**
   * The Confirm of a /grant (V1-42), in one transaction under the lock of the user: once per
   * confirmation screen (`nonce`, unique in `SubscriptionGrant`, written with the activation),
   * and only while the plan is still the one the screen showed.
   */
  confirmGrant: (
    input: GrantInput & { nonce: string; expected: GrantExpectation },
  ) => Promise<GrantConfirmation>;
  /** Whether a Confirm already activated a plan with this nonce (V1-42). */
  isGrantUsed: (nonce: string) => Promise<boolean>;
  /** ACTIVE rows whose end has passed → EXPIRED; returns the rows it changed (V1-34). */
  expireDueSubscriptions: (now: Date) => Promise<ExpiredSubscription[]>;
};

type LockedPayment = {
  userId: string | null;
  plan: Plan;
  duration: PlanDuration;
  status: PaymentStatus;
};

/** An invoice can be paid late: up to 24 h after its expiry or its cancellation (V1-28). */
const CLAIMABLE = PAYMENT_STATUSES.filter((status) => !isPaid(status));

/**
 * Locks, in this order everywhere (no deadlock): the invoice, then the user. The invoice lock
 * makes two detections of one payment (worker V1-32, "I've paid" V1-30) activate it once; the
 * user lock keeps an extension from being computed on an end another activation just moved.
 */
async function lockPayment(tx: Db, paymentId: string): Promise<LockedPayment | undefined> {
  const rows = await tx.$queryRaw<LockedPayment[]>`
    SELECT "userId", plan::text AS plan, duration::text AS duration, status::text AS status
    FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  return rows[0];
}

/**
 * Applies the rules at this very moment, under the user lock: the situation may have changed
 * since the invoice was made. One row per continuous period of a plan: an extension moves the
 * end of the row and records the duration of the last pass (V1-34 picks its notice from it).
 */
async function applyActivation(
  tx: Db,
  input: {
    userId: string;
    offer: Offer;
    now: Date;
    mode: ActivationMode;
    paymentId: string | null;
  },
): Promise<Activated | { status: "REFUSED" }> {
  const { userId, offer, now, mode, paymentId } = input;
  // Rows that ended are expired first: the one-active index would refuse the new row.
  await tx.subscription.updateMany({
    where: { userId, ...isDue(now) },
    data: { status: "EXPIRED" },
  });
  const current = await getActiveSubscription(tx, userId, now);
  const computed = computeActivation(current, offer, now, mode);
  if (computed.kind === "REFUSED") return { status: "REFUSED" };

  const activated = (subscription: SubscriptionInfo): Activated => ({
    status: "ACTIVATED",
    kind: computed.kind,
    subscription,
  });
  const create = async () =>
    activated(
      await tx.subscription.create({
        data: {
          userId,
          plan: offer.plan,
          duration: offer.duration,
          startsAt: computed.startsAt,
          expiresAt: computed.expiresAt,
          paymentId,
        },
        select: INFO,
      }),
    );

  if (current === null || computed.kind === "NEW") return create();
  if (computed.kind === "UPGRADE") {
    // The Classic ends now: the row keeps the real end of the period (§8.4, time lost).
    await tx.subscription.update({
      where: { id: current.id },
      data: { status: "EXPIRED", expiresAt: now },
    });
    return create();
  }
  return activated(
    await tx.subscription.update({
      where: { id: current.id },
      data: { expiresAt: computed.expiresAt, duration: offer.duration },
      select: INFO,
    }),
  );
}

/** A grant refuses Classic during Premium (§8.4): it never gives EXTEND_PREMIUM, a payment does. */
function grantKindOf(kind: ActivationKind): GrantKind {
  if (kind === "EXTEND_PREMIUM") throw new Error("A grant never extends a Premium with a Classic");
  return kind;
}

export function createSubscriptionService(deps: { prisma: PrismaClient }): SubscriptionService {
  const { prisma } = deps;

  const alreadyActivated = (paymentId: string): ActivationResult => {
    log.info({ paymentId }, "subscription.already_activated");
    return { status: "ALREADY_ACTIVATED" };
  };

  async function activate(tx: Db, paymentId: string, now: Date): Promise<ActivationResult> {
    const payment = await lockPayment(tx, paymentId);
    if (payment === undefined) throw new Error("Unknown payment");
    if (isPaid(payment.status)) return alreadyActivated(paymentId);
    const { userId } = payment;
    if (userId === null) {
      log.warn({ paymentId }, "subscription.user_deleted");
      return { status: "USER_DELETED" };
    }
    await lockUserRow(tx, userId);
    // Second guard, the conditional update: only one caller claims the invoice.
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: CLAIMABLE } },
      data: { status: "PAID", paidAt: now },
    });
    if (claimed.count === 0) return alreadyActivated(paymentId);

    const offer = getOffer(payment.plan, payment.duration);
    const result = await applyActivation(tx, { userId, offer, now, mode: "PAYMENT", paymentId });
    // A payment is never refused: Classic during Premium extends the Premium (EXTEND_PREMIUM).
    if (result.status === "REFUSED") throw new Error("A paid invoice cannot be refused");
    const { kind, subscription } = result;
    const logged = { userId, paymentId, plan: subscription.plan, kind };
    if (kind === "EXTEND_PREMIUM") log.warn(logged, "subscription.classic_paid_during_premium");
    log.info({ ...logged, expiresAt: subscription.expiresAt }, "subscription.activated");
    return result;
  }

  async function grant(tx: Db, input: GrantInput): Promise<GrantResult> {
    if (!(await lockUserRow(tx, input.userId))) return { status: "USER_DELETED" };
    return grantLocked(tx, input);
  }

  /** `grant` once the row of the user is locked. */
  async function grantLocked(tx: Db, input: GrantInput): Promise<GrantResult> {
    const { userId, offer, now, actorTelegramId } = input;
    const result = await applyActivation(tx, {
      userId,
      offer,
      now,
      mode: "GRANT",
      paymentId: null,
    });
    if (result.status === "ACTIVATED") {
      const { kind, subscription } = result;
      log.info(
        {
          userId,
          actorTelegramId: actorTelegramId.toString(),
          plan: subscription.plan,
          kind,
          expiresAt: subscription.expiresAt,
        },
        "subscription.granted",
      );
    }
    return result;
  }

  async function confirm(
    tx: Db,
    input: GrantInput & { nonce: string; expected: GrantExpectation },
  ): Promise<GrantConfirmation> {
    const { nonce, expected, userId, offer, now } = input;
    if (!(await lockUserRow(tx, userId))) return { status: "USER_DELETED" };
    // Under the lock: a second click of the same Confirm waited, then finds the first one's row.
    if ((await tx.subscriptionGrant.count({ where: { nonce } })) > 0) return { status: "USED" };
    const current = await getActiveSubscription(tx, userId, now);
    const computed = computeActivation(current, offer, now, "GRANT");
    const extensionMoved =
      computed.kind === "EXTEND" &&
      current?.expiresAt.getTime() !== expected.currentExpiresAt?.getTime();
    if (computed.kind !== expected.kind || extensionMoved) return { status: "CHANGED" };

    const result = await grantLocked(tx, input);
    if (result.status !== "ACTIVATED") return result;
    await tx.subscriptionGrant.create({
      data: {
        nonce,
        adminTelegramId: input.actorTelegramId,
        userId,
        subscriptionId: result.subscription.id,
        plan: offer.plan,
        duration: offer.duration,
        kind: grantKindOf(result.kind),
        expiresAt: result.subscription.expiresAt,
      },
    });
    return result;
  }

  return {
    activateFromPayment: (paymentId, now, tx) =>
      tx === undefined
        ? prisma.$transaction((inner) => activate(inner, paymentId, now))
        : activate(tx, paymentId, now),

    grantSubscription: (input) => prisma.$transaction((tx) => grant(tx, input)),

    previewGrant: async (userId, offer, now) => {
      const status = await getPlanStatus(prisma, userId, now);
      const active = status.kind === "ACTIVE" ? status.subscription : null;
      return { status, computed: computeActivation(active, offer, now, "GRANT") };
    },

    async confirmGrant(input) {
      try {
        return await prisma.$transaction((tx) => confirm(tx, input));
      } catch (error) {
        // The unique nonce is the last net: the activation of a second insert is rolled back.
        if (isUniqueViolation(error)) return { status: "USED" };
        throw error;
      }
    },

    isGrantUsed: async (nonce) => (await prisma.subscriptionGrant.count({ where: { nonce } })) > 0,

    expireDueSubscriptions: (now) =>
      prisma.subscription.updateManyAndReturn({
        where: isDue(now),
        data: { status: "EXPIRED" },
        select: { id: true, userId: true, plan: true },
      }),
  };
}
