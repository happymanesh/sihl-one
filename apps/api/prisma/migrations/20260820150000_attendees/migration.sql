-- Who else took part, besides the owner.
--
-- Planned attendees hang off the task, actual attendees off the visit. Two
-- nullable foreign keys rather than a polymorphic pair, so the database can
-- enforce that an attendee belongs to something real.
--
-- Cascade from task and visit: an attendee record has no meaning once the thing
-- attended is gone. Cascade from user is the same reasoning — though users are
-- soft-deleted in practice, so this rarely fires.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendeeRole') THEN
        CREATE TYPE "AttendeeRole" AS ENUM ('SUPPORT', 'PRODUCT_EXPERT', 'MANAGER');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "attendee" (
    "id"        TEXT NOT NULL,
    "taskId"    TEXT,
    "visitId"   TEXT,
    "userId"    TEXT NOT NULL,
    "role"      "AttendeeRole" NOT NULL DEFAULT 'SUPPORT',
    "addedById" TEXT,
    "addedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendee_pkey" PRIMARY KEY ("id")
);

-- One row per person per task or visit: adding the same colleague twice is a
-- mis-click, not a second attendance.
CREATE UNIQUE INDEX IF NOT EXISTS "attendee_taskId_userId_key"  ON "attendee"("taskId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "attendee_visitId_userId_key" ON "attendee"("visitId", "userId");
CREATE INDEX IF NOT EXISTS "attendee_userId_idx" ON "attendee"("userId");

-- Exactly one parent. Without this a row could belong to both a task and a
-- visit, or to neither, and every read would have to guess which.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendee_one_parent') THEN
        ALTER TABLE "attendee"
            ADD CONSTRAINT "attendee_one_parent"
            CHECK (("taskId" IS NOT NULL) <> ("visitId" IS NOT NULL));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendee_taskId_fkey') THEN
        ALTER TABLE "attendee" ADD CONSTRAINT "attendee_taskId_fkey"
            FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendee_visitId_fkey') THEN
        ALTER TABLE "attendee" ADD CONSTRAINT "attendee_visitId_fkey"
            FOREIGN KEY ("visitId") REFERENCES "visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendee_userId_fkey') THEN
        ALTER TABLE "attendee" ADD CONSTRAINT "attendee_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
