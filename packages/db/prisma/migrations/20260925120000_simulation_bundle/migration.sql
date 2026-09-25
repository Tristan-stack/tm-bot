-- Decision of 25/09/2026: the dev buys 1 SOL, then the bundle the user picks. A simulation is
-- found again by its bundle too; the rows made before it had none.

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "bundleSol" DECIMAL(20,9) NOT NULL DEFAULT 0;
