-- CreateTable
CREATE TABLE "shares" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shares_tokenHash_key" ON "shares"("tokenHash");

-- CreateIndex
CREATE INDEX "shares_projectId_idx" ON "shares"("projectId");

-- CreateIndex
CREATE INDEX "shares_organizationId_idx" ON "shares"("organizationId");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
