-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "kind" "MediaKind" NOT NULL DEFAULT 'PHOTO';
