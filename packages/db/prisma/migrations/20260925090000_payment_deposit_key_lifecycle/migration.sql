-- V1-33: the deposit keys are erased after the 30 days of monitoring (the key columns were
-- already nullable), the SWEEP FAILED alert goes out once, and the transfers of a deposit to
-- the treasury are recorded as withdrawals.

-- AlterEnum
ALTER TYPE "WithdrawalKind" ADD VALUE 'DEPOSIT_SWEEP';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "keyDeletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sweepAlertedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Withdrawal_fromAddress_status_idx" ON "Withdrawal"("fromAddress", "status");
