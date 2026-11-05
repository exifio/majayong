-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replacedById_key" ON "refresh_sessions"("replacedById");

-- CreateIndex
CREATE INDEX "refresh_sessions_familyId_revokedAt_idx" ON "refresh_sessions"("familyId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_expiresAt_idx" ON "refresh_sessions"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "refresh_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
