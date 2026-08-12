-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateTable
CREATE TABLE "sales_target" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "conversionTarget" INTEGER,
    "valueTarget" DECIMAL(18,2),
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_target_periodStart_idx" ON "sales_target"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "sales_target_userId_period_periodStart_key" ON "sales_target"("userId", "period", "periodStart");

-- AddForeignKey
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
