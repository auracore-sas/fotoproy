/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `photos` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnailUrl` on the `photos` table. All the data in the column will be lost.
  - Added the required column `storageKey` to the `photos` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "photos" DROP COLUMN "imageUrl",
DROP COLUMN "thumbnailUrl",
ADD COLUMN     "storageKey" TEXT NOT NULL,
ADD COLUMN     "thumbnailStorageKey" TEXT;
