-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'PARTNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'ZONE', 'REGION', 'BRANCH', 'TEAM', 'SELF');

-- CreateEnum
CREATE TYPE "OrgUnitType" AS ENUM ('COMPANY', 'ZONE', 'REGION', 'BRANCH', 'TEAM');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CONVERTED', 'LOST', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'CAMPAIGN', 'REFERRAL', 'PARTNER', 'WALK_IN', 'INBOUND_CALL', 'OUTBOUND_CALL', 'SOCIAL', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadLostReason" AS ENUM ('PRICE', 'COMPETITOR', 'NOT_INTERESTED', 'UNREACHABLE', 'INELIGIBLE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProductInterest" AS ENUM ('EQUITY', 'DERIVATIVES', 'COMMODITY', 'CURRENCY', 'MUTUAL_FUNDS', 'IPO', 'PMS', 'AIF', 'INSURANCE', 'BONDS', 'NRI', 'ALGO');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ONBOARDING', 'ACTIVE', 'DORMANT', 'CLOSED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ON_HOLD', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('LEAD', 'KYC_STARTED', 'PAN_VERIFIED', 'BANK_VERIFIED', 'ESIGN_PENDING', 'ESIGN_DONE', 'UNDER_REVIEW', 'ACCOUNT_OPENED', 'ACTIVATED');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('AUTHORISED_PERSON', 'REMISIER', 'REFERRAL', 'IFA', 'CORPORATE');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'SOCIAL', 'SEARCH', 'DISPLAY', 'OFFLINE', 'REFERRAL');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('LEAD', 'CUSTOMER', 'PARTNER', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'VISIT', 'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT', 'DOCUMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANNED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'MISSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'ASSIGN', 'EXPORT', 'STATUS_CHANGE', 'PERMISSION_DENIED');

-- CreateTable
CREATE TABLE "org_unit" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "OrgUnitType" NOT NULL,
    "parentId" TEXT,
    "path" VARCHAR(1000) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "firstName" VARCHAR(60) NOT NULL,
    "lastName" VARCHAR(60) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "mobile" VARCHAR(15),
    "passwordHash" VARCHAR(255),
    "userType" "UserType" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "dataScope" "DataScope",
    "orgUnitId" TEXT,
    "managerId" TEXT,
    "partnerId" TEXT,
    "avatarUrl" VARCHAR(500),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "userId" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("userId","roleCode")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "deviceId" VARCHAR(120),
    "deviceLabel" VARCHAR(120),
    "userAgent" VARCHAR(400),
    "ipAddress" VARCHAR(45),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(120),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(160) NOT NULL,
    "userId" TEXT,
    "successful" BOOLEAN NOT NULL,
    "failReason" VARCHAR(80),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "firstName" VARCHAR(60) NOT NULL,
    "lastName" VARCHAR(60),
    "mobile" VARCHAR(15) NOT NULL,
    "email" VARCHAR(160),
    "pan" VARCHAR(10),
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "productInterest" "ProductInterest"[],
    "estimatedValue" DECIMAL(18,2),
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreFactors" JSONB,
    "scoredAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "orgUnitId" TEXT,
    "partnerId" TEXT,
    "campaignId" TEXT,
    "utmSource" VARCHAR(120),
    "utmMedium" VARCHAR(120),
    "utmCampaign" VARCHAR(160),
    "utmTerm" VARCHAR(160),
    "utmContent" VARCHAR(160),
    "referrerUrl" VARCHAR(500),
    "landingPath" VARCHAR(500),
    "gclid" VARCHAR(200),
    "fbclid" VARCHAR(200),
    "nextFollowUpAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" "LeadLostReason",
    "lostNote" VARCHAR(500),
    "mergedIntoId" TEXT,
    "customerId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus" NOT NULL,
    "note" VARCHAR(1000),
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" INTEGER,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "clientCode" VARCHAR(30),
    "firstName" VARCHAR(60) NOT NULL,
    "lastName" VARCHAR(60),
    "email" VARCHAR(160) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "pan" VARCHAR(10) NOT NULL,
    "dateOfBirth" DATE,
    "addressLine1" VARCHAR(160),
    "addressLine2" VARCHAR(160),
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "status" "CustomerStatus" NOT NULL DEFAULT 'PROSPECT',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "onboardingStage" "OnboardingStage" NOT NULL DEFAULT 'LEAD',
    "stageUpdatedAt" TIMESTAMP(3),
    "accountOpenedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "firstTradeAt" TIMESTAMP(3),
    "productInterest" "ProductInterest"[],
    "relationshipManagerId" TEXT,
    "orgUnitId" TEXT,
    "partnerId" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_product" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "product" "ProductInterest" NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "currentValue" DECIMAL(18,2),
    "sourceSystem" VARCHAR(40) NOT NULL DEFAULT 'BACKOFFICE',
    "externalRef" VARCHAR(80),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "PartnerType" NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
    "contactPerson" VARCHAR(120),
    "email" VARCHAR(160) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "pan" VARCHAR(10),
    "gstin" VARCHAR(15),
    "sebiRegNo" VARCHAR(40),
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "commissionRate" DECIMAL(5,2),
    "orgUnitId" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channels" "CampaignChannel"[],
    "objective" VARCHAR(200),
    "budget" DECIMAL(18,2),
    "actualSpend" DECIMAL(18,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "direction" "ActivityDirection" NOT NULL DEFAULT 'OUTBOUND',
    "subject" VARCHAR(160) NOT NULL,
    "body" VARCHAR(4000),
    "outcome" VARCHAR(120),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMinutes" INTEGER,
    "actorId" TEXT,
    "isSystemGenerated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "entityType" "EntityType",
    "entityId" TEXT,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "completedAt" TIMESTAMP(3),
    "completionNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'PLANNED',
    "purpose" VARCHAR(200) NOT NULL,
    "plannedAt" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3),
    "checkInLatitude" DECIMAL(10,7),
    "checkInLongitude" DECIMAL(10,7),
    "checkInAccuracy" DECIMAL(8,2),
    "checkInAddress" VARCHAR(400),
    "checkInPhotoKey" VARCHAR(300),
    "checkOutAt" TIMESTAMP(3),
    "checkOutLatitude" DECIMAL(10,7),
    "checkOutLongitude" DECIMAL(10,7),
    "checkOutAccuracy" DECIMAL(8,2),
    "durationMinutes" INTEGER,
    "meetingNotes" VARCHAR(4000),
    "voiceNoteKey" VARCHAR(300),
    "outcome" VARCHAR(200),
    "nextFollowUpAt" TIMESTAMP(3),
    "deviceId" VARCHAR(120),
    "deviceInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "category" VARCHAR(60),
    "scanStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "scanResult" VARCHAR(200),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "purpose" VARCHAR(80) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "channel" VARCHAR(40),
    "consentText" VARCHAR(2000),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(400),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" VARCHAR(160),
    "action" "AuditAction" NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "resourceId" VARCHAR(64),
    "changes" JSONB,
    "reason" VARCHAR(300),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(400),
    "traceId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "aggregateType" VARCHAR(60) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter" (
    "key" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_unit_code_key" ON "org_unit"("code");

-- CreateIndex
CREATE INDEX "org_unit_parentId_idx" ON "org_unit"("parentId");

-- CreateIndex
CREATE INDEX "org_unit_path_idx" ON "org_unit"("path");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_reference_key" ON "app_user"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_mobile_key" ON "app_user"("mobile");

-- CreateIndex
CREATE INDEX "app_user_orgUnitId_idx" ON "app_user"("orgUnitId");

-- CreateIndex
CREATE INDEX "app_user_managerId_idx" ON "app_user"("managerId");

-- CreateIndex
CREATE INDEX "app_user_partnerId_idx" ON "app_user"("partnerId");

-- CreateIndex
CREATE INDEX "app_user_status_idx" ON "app_user"("status");

-- CreateIndex
CREATE INDEX "user_role_roleCode_idx" ON "user_role"("roleCode");

-- CreateIndex
CREATE UNIQUE INDEX "session_refreshTokenHash_key" ON "session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempt_identifier_createdAt_idx" ON "login_attempt"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempt_userId_createdAt_idx" ON "login_attempt"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_reference_key" ON "lead"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "lead_customerId_key" ON "lead"("customerId");

-- CreateIndex
CREATE INDEX "lead_mobile_idx" ON "lead"("mobile");

-- CreateIndex
CREATE INDEX "lead_email_idx" ON "lead"("email");

-- CreateIndex
CREATE INDEX "lead_status_createdAt_idx" ON "lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lead_ownerId_status_idx" ON "lead"("ownerId", "status");

-- CreateIndex
CREATE INDEX "lead_orgUnitId_idx" ON "lead"("orgUnitId");

-- CreateIndex
CREATE INDEX "lead_partnerId_idx" ON "lead"("partnerId");

-- CreateIndex
CREATE INDEX "lead_campaignId_idx" ON "lead"("campaignId");

-- CreateIndex
CREATE INDEX "lead_nextFollowUpAt_idx" ON "lead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "lead_score_idx" ON "lead"("score");

-- CreateIndex
CREATE INDEX "lead_status_history_leadId_changedAt_idx" ON "lead_status_history"("leadId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_reference_key" ON "customer"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "customer_clientCode_key" ON "customer"("clientCode");

-- CreateIndex
CREATE UNIQUE INDEX "customer_pan_key" ON "customer"("pan");

-- CreateIndex
CREATE INDEX "customer_status_idx" ON "customer"("status");

-- CreateIndex
CREATE INDEX "customer_kycStatus_idx" ON "customer"("kycStatus");

-- CreateIndex
CREATE INDEX "customer_onboardingStage_idx" ON "customer"("onboardingStage");

-- CreateIndex
CREATE INDEX "customer_relationshipManagerId_idx" ON "customer"("relationshipManagerId");

-- CreateIndex
CREATE INDEX "customer_orgUnitId_idx" ON "customer"("orgUnitId");

-- CreateIndex
CREATE INDEX "customer_partnerId_idx" ON "customer"("partnerId");

-- CreateIndex
CREATE INDEX "customer_mobile_idx" ON "customer"("mobile");

-- CreateIndex
CREATE INDEX "customer_product_customerId_idx" ON "customer_product"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_product_customerId_product_key" ON "customer_product"("customerId", "product");

-- CreateIndex
CREATE UNIQUE INDEX "partner_reference_key" ON "partner"("reference");

-- CreateIndex
CREATE INDEX "partner_status_idx" ON "partner"("status");

-- CreateIndex
CREATE INDEX "partner_type_idx" ON "partner"("type");

-- CreateIndex
CREATE INDEX "partner_orgUnitId_idx" ON "partner"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_reference_key" ON "campaign"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_code_key" ON "campaign"("code");

-- CreateIndex
CREATE INDEX "campaign_status_idx" ON "campaign"("status");

-- CreateIndex
CREATE INDEX "campaign_code_idx" ON "campaign"("code");

-- CreateIndex
CREATE INDEX "activity_entityType_entityId_occurredAt_idx" ON "activity"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_actorId_occurredAt_idx" ON "activity"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_type_idx" ON "activity"("type");

-- CreateIndex
CREATE UNIQUE INDEX "task_reference_key" ON "task"("reference");

-- CreateIndex
CREATE INDEX "task_assigneeId_status_dueAt_idx" ON "task"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "task_entityType_entityId_idx" ON "task"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "visit_reference_key" ON "visit"("reference");

-- CreateIndex
CREATE INDEX "visit_userId_checkInAt_idx" ON "visit"("userId", "checkInAt");

-- CreateIndex
CREATE INDEX "visit_entityType_entityId_idx" ON "visit"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "visit_status_idx" ON "visit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "document_entityType_entityId_idx" ON "document"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "consent_record_entityType_entityId_idx" ON "consent_record"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "consent_record_leadId_idx" ON "consent_record"("leadId");

-- CreateIndex
CREATE INDEX "consent_record_customerId_idx" ON "consent_record"("customerId");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_resource_resourceId_idx" ON "audit_log"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "outbox_event_publishedAt_occurredAt_idx" ON "outbox_event"("publishedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "outbox_event_aggregateType_aggregateId_idx" ON "outbox_event"("aggregateType", "aggregateId");

-- AddForeignKey
ALTER TABLE "org_unit" ADD CONSTRAINT "org_unit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_relationshipManagerId_fkey" FOREIGN KEY ("relationshipManagerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product" ADD CONSTRAINT "customer_product_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
