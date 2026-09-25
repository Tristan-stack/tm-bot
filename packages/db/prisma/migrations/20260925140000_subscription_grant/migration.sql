-- /grant (V1-42): the manual activations, and the one-use guard of their Confirm (unique nonce).

-- CreateEnum
CREATE TYPE "GrantKind" AS ENUM ('NEW', 'EXTEND', 'UPGRADE');

-- CreateTable
CREATE TABLE "SubscriptionGrant" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "adminTelegramId" BIGINT NOT NULL,
    "userId" TEXT,
    "subscriptionId" TEXT,
    "plan" "Plan" NOT NULL,
    "duration" "PlanDuration" NOT NULL,
    "kind" "GrantKind" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionGrant_nonce_key" ON "SubscriptionGrant"("nonce");

-- CreateIndex
CREATE INDEX "SubscriptionGrant_userId_createdAt_idx" ON "SubscriptionGrant"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
