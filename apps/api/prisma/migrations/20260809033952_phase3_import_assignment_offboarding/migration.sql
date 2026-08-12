-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PARSED', 'VALIDATED', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssignmentStrategy" AS ENUM ('ROUND_ROBIN', 'LOAD_BALANCED', 'FIXED_OWNER', 'LEAVE_UNASSIGNED');

-- DropIndex
DROP INDEX "customer_mobile_trgm";

-- DropIndex
DROP INDEX "lead_mobile_trgm";

-- DropIndex
DROP INDEX "lead_reference_trgm";

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "noticePeriodFrom" TIMESTAMP(3),
ADD COLUMN     "offboardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "lead_import_batch" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PARSED',
    "sourceOrigin" VARCHAR(40) NOT NULL,
    "suppliedBy" VARCHAR(160) NOT NULL,
    "sourceDescription" VARCHAR(500) NOT NULL,
    "lawfulBasisConfirmedAt" TIMESTAMP(3) NOT NULL,
    "mapping" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "lead_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_import_row" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'VALID',
    "raw" JSONB NOT NULL,
    "mapped" JSONB,
    "errors" JSONB,
    "duplicateOfLeadId" TEXT,
    "matchScore" INTEGER,
    "matchReasons" JSONB,
    "createdLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_rule" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "strategy" "AssignmentStrategy" NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "targetUserIds" TEXT[],
    "orgUnitId" TEXT,
    "roundRobinCursor" INTEGER NOT NULL DEFAULT 0,
    "assignmentCount" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_import_batch_reference_key" ON "lead_import_batch"("reference");

-- CreateIndex
CREATE INDEX "lead_import_batch_status_createdAt_idx" ON "lead_import_batch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lead_import_batch_importedById_idx" ON "lead_import_batch"("importedById");

-- CreateIndex
CREATE INDEX "lead_import_row_batchId_status_idx" ON "lead_import_row"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_import_row_batchId_rowNumber_key" ON "lead_import_row"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "assignment_rule_isActive_priority_idx" ON "assignment_rule"("isActive", "priority");

-- CreateIndex
CREATE INDEX "lead_importBatchId_idx" ON "lead"("importBatchId");

-- CreateIndex
CREATE INDEX "lead_consentStatus_idx" ON "lead"("consentStatus");

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "lead_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_import_batch" ADD CONSTRAINT "lead_import_batch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_import_row" ADD CONSTRAINT "lead_import_row_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "lead_import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_import_row" ADD CONSTRAINT "lead_import_row_createdLeadId_fkey" FOREIGN KEY ("createdLeadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rule" ADD CONSTRAINT "assignment_rule_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
