
-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "partner" ADD COLUMN     "referralCode" VARCHAR(24);

-- CreateTable
CREATE TABLE "event" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "venue" VARCHAR(200),
    "city" VARCHAR(80),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "expectedFootfall" INTEGER,
    "ownerId" TEXT,
    "orgUnitId" TEXT,
    "campaignId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_reference_key" ON "event"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "event_code_key" ON "event"("code");

-- CreateIndex
CREATE INDEX "event_status_idx" ON "event"("status");

-- CreateIndex
CREATE INDEX "event_code_idx" ON "event"("code");

-- CreateIndex
CREATE INDEX "event_startsAt_idx" ON "event"("startsAt");

-- CreateIndex
CREATE INDEX "lead_eventId_idx" ON "lead"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_referralCode_key" ON "partner"("referralCode");

-- CreateIndex
CREATE INDEX "partner_referralCode_idx" ON "partner"("referralCode");

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
