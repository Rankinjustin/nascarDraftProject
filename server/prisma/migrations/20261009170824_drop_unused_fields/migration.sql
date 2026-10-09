/*
  Warnings:

  - You are about to drop the column `isActive` on the `Driver` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "NotificationLog_raceId_idx";

-- DropIndex
DROP INDEX "QualifyingResult_raceId_idx";

-- DropIndex
DROP INDEX "RaceEntry_raceId_idx";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "Driver" DROP COLUMN "isActive";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email";

