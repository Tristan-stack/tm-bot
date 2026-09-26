-- A launch is funded to a fresh wallet of its own, hidden from the user's screens
-- (decision of 26/09/2026).

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('USER', 'LAUNCH');

-- AlterEnum
ALTER TYPE "WithdrawalKind" ADD VALUE 'LAUNCH_FUNDING';

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "kind" "WalletKind" NOT NULL DEFAULT 'USER';
