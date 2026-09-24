-- V1-34: the reminder before the end of a plan, claimed before it is sent, re-armed when an
-- extension moves the end.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "reminderForExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "reminderSentAt" TIMESTAMPTZ(3);
