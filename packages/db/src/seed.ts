import { createLogger, loadDotenvOnce } from "@launchbot/shared/server";
import { disconnectPrisma, prisma } from "./client.js";

// Optional dev seed, idempotent: one user with a pass and a token draft. No wallet.
// The pass is Premium ending in 28 h by default; for the variants of the offers screen (V1-29):
// SEED_PLAN=CLASSIC|PREMIUM, SEED_HOURS=<hours left> (200 → "until 12 Oct", -1 → expired).

const FALLBACK_TELEGRAM_ID = 123456789n;
const SEED_DRAFT_ID = "seed_token_draft_moon_otter";
const SEED_SUBSCRIPTION_ID = "seed_subscription_premium";
const HOUR_MS = 60 * 60 * 1000;

const log = createLogger("seed");

/** First id of ADMIN_TELEGRAM_IDS, so the seeded account is the developer's own. */
function seedTelegramId(): bigint {
  const first = process.env["ADMIN_TELEGRAM_IDS"]?.split(",")[0]?.trim();
  return first !== undefined && /^\d+$/.test(first) ? BigInt(first) : FALLBACK_TELEGRAM_ID;
}

async function seed(): Promise<void> {
  const telegramId = seedTelegramId();
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId, username: "dev_user", firstName: "Dev" },
    update: {},
  });

  // 28 h by default: the home screen shows "Premium · 1d 4h left".
  const plan = process.env["SEED_PLAN"] === "CLASSIC" ? "CLASSIC" : "PREMIUM";
  const asked = Number(process.env["SEED_HOURS"] ?? 28);
  const hours = Number.isFinite(asked) ? asked : 28;
  const now = new Date();
  const subscription = {
    userId: user.id,
    plan,
    duration: "TWO_DAYS",
    status: hours > 0 ? "ACTIVE" : "EXPIRED",
    startsAt: now,
    expiresAt: new Date(now.getTime() + hours * HOUR_MS),
  } as const;
  // One ACTIVE subscription per user (V1-27): any other one ends first.
  await prisma.subscription.updateMany({
    where: { userId: user.id, status: "ACTIVE", id: { not: SEED_SUBSCRIPTION_ID } },
    data: { status: "EXPIRED", expiresAt: now },
  });
  await prisma.subscription.upsert({
    where: { id: SEED_SUBSCRIPTION_ID },
    create: { id: SEED_SUBSCRIPTION_ID, ...subscription },
    update: subscription,
  });

  const draft = {
    userId: user.id,
    name: "Moon Otter",
    symbol: "OTTR",
    description: "An otter who loves the stars.",
  };
  await prisma.tokenDraft.upsert({
    where: { id: SEED_DRAFT_ID },
    create: { id: SEED_DRAFT_ID, ...draft },
    update: draft,
  });

  log.info({ telegramId: telegramId.toString() }, "Dev seed applied");
}

loadDotenvOnce();
if (process.env["NODE_ENV"] === "production") {
  log.error("The dev seed refuses to run with NODE_ENV=production");
  process.exitCode = 1;
} else {
  try {
    await seed();
  } finally {
    await disconnectPrisma();
  }
}
