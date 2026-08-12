-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessagePurpose" AS ENUM ('TRANSACTIONAL', 'SERVICE', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "dndRegistered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "dndRegistered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "message_template" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "purpose" "MessagePurpose" NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "providerTemplateId" VARCHAR(120),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_log" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "templateCode" VARCHAR(40) NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "purpose" "MessagePurpose" NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "destination" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "decisionCode" VARCHAR(40) NOT NULL,
    "failureReason" VARCHAR(400),
    "providerMessageId" VARCHAR(160),
    "requestedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_opt_out" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" VARCHAR(64) NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_opt_out_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_template_code_key" ON "message_template"("code");

-- CreateIndex
CREATE INDEX "message_template_channel_isActive_idx" ON "message_template"("channel", "isActive");

-- CreateIndex
CREATE INDEX "message_log_status_createdAt_idx" ON "message_log"("status", "createdAt");

-- CreateIndex
CREATE INDEX "message_log_leadId_idx" ON "message_log"("leadId");

-- CreateIndex
CREATE INDEX "message_log_customerId_idx" ON "message_log"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "message_opt_out_entityType_entityId_channel_key" ON "message_opt_out"("entityType", "entityId", "channel");

-- AddForeignKey
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

