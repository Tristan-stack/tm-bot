-- The fresh wallet of a launch is emptied into the treasury a minute after its funding, then
-- erased (decision of 26/09/2026).

-- AlterEnum
ALTER TYPE "WithdrawalKind" ADD VALUE 'LAUNCH_SWEEP';

-- CreateIndex
CREATE INDEX "Wallet_kind_createdAt_idx" ON "Wallet"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_toAddress_status_idx" ON "Withdrawal"("toAddress", "status");
