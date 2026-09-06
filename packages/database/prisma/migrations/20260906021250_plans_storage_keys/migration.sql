/*
  Warnings:

  - You are about to drop the column `fileUrl` on the `project_plans` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnailUrl` on the `project_plans` table. All the data in the column will be lost.
  - Added the required column `storageKey` to the `project_plans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "project_plans" DROP COLUMN "fileUrl",
DROP COLUMN "thumbnailUrl",
ADD COLUMN     "storageKey" TEXT NOT NULL,
ADD COLUMN     "thumbnailStorageKey" TEXT;
