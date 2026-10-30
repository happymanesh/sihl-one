-- Training sessions, their branches and their material.
--
-- Independent of Test by design: a branch runs training nobody is examined on,
-- and sets exams on material nobody was trained for.
--
-- Idempotent throughout, because a Prisma multi-statement migration is not
-- transactional: a failure halfway must leave something a re-run can finish.
CREATE TABLE IF NOT EXISTS "training" (
  "id"              TEXT         NOT NULL,
  "topic"           VARCHAR(160) NOT NULL,
  "startsAt"        TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER      NOT NULL DEFAULT 30,
  "presenterName"   VARCHAR(120),
  "presenterId"     TEXT,
  "remarks"         VARCHAR(2000),
  "status"          VARCHAR(20)  NOT NULL DEFAULT 'SCHEDULED',
  "createdById"     TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "training_startsAt_idx" ON "training" ("startsAt");
CREATE INDEX IF NOT EXISTS "training_status_startsAt_idx" ON "training" ("status", "startsAt");

CREATE TABLE IF NOT EXISTS "training_branch" (
  "trainingId" TEXT NOT NULL,
  "orgUnitId"  TEXT NOT NULL,
  CONSTRAINT "training_branch_pkey" PRIMARY KEY ("trainingId", "orgUnitId")
);

CREATE INDEX IF NOT EXISTS "training_branch_orgUnitId_idx" ON "training_branch" ("orgUnitId");

CREATE TABLE IF NOT EXISTS "training_material" (
  "id"           TEXT         NOT NULL,
  "trainingId"   TEXT         NOT NULL,
  "fileName"     VARCHAR(255) NOT NULL,
  "mimeType"     VARCHAR(120) NOT NULL,
  "sizeBytes"    INTEGER      NOT NULL,
  "storageKey"   VARCHAR(300) NOT NULL,
  "uploadedById" TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "training_material_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "training_material_storageKey_key"
  ON "training_material" ("storageKey");
CREATE INDEX IF NOT EXISTS "training_material_trainingId_idx"
  ON "training_material" ("trainingId");

DO $$
BEGIN
  -- A presenter who leaves keeps the training; the name column still says who
  -- gave it, which is the part a report needs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_presenterId_fkey') THEN
    ALTER TABLE "training" ADD CONSTRAINT "training_presenterId_fkey"
      FOREIGN KEY ("presenterId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Restrict on the creator: who scheduled it is part of the record.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_createdById_fkey') THEN
    ALTER TABLE "training" ADD CONSTRAINT "training_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_branch_trainingId_fkey') THEN
    ALTER TABLE "training_branch" ADD CONSTRAINT "training_branch_trainingId_fkey"
      FOREIGN KEY ("trainingId") REFERENCES "training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_branch_orgUnitId_fkey') THEN
    ALTER TABLE "training_branch" ADD CONSTRAINT "training_branch_orgUnitId_fkey"
      FOREIGN KEY ("orgUnitId") REFERENCES "org_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_material_trainingId_fkey') THEN
    ALTER TABLE "training_material" ADD CONSTRAINT "training_material_trainingId_fkey"
      FOREIGN KEY ("trainingId") REFERENCES "training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_material_uploadedById_fkey') THEN
    ALTER TABLE "training_material" ADD CONSTRAINT "training_material_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
