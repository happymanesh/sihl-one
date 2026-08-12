-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "mfaEnrolledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mfa_recovery_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_code_codeHash_key" ON "mfa_recovery_code"("codeHash");

-- CreateIndex
CREATE INDEX "mfa_recovery_code_userId_idx" ON "mfa_recovery_code"("userId");

-- AddForeignKey
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

