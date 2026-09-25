/*
  Warnings:

  - You are about to drop the column `termsAcceptedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `termsVersion` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable: no Terms of Service or Privacy Policy any more (decision of 25/09/2026, V1-41)
ALTER TABLE "User" DROP COLUMN "termsAcceptedAt",
DROP COLUMN "termsVersion";
