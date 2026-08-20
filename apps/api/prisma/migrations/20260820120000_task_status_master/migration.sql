-- Task status becomes an admin-managed master.
--
-- Hand-written, not generated. Prisma's diff for an enum-to-varchar change is a
-- DROP COLUMN followed by an ADD COLUMN, which would reset the status of every
-- task in the system. The column is converted in place with USING so existing
-- values survive as their own codes.
--
-- The four original enum values become both the seeded system statuses and the
-- fixed categories. Every query keys off the category from here on, so an
-- administrator adding a status under IN_PROGRESS changes nothing in code.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration in
-- one transaction, so a failure part-way leaves the earlier statements applied —
-- as happened on the first attempt here, which created the type and table and
-- then failed on the column. Without guards, the retry fails on "already
-- exists" and the migration can never move forward.

-- 1. Categories --------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskStatusCategory') THEN
        CREATE TYPE "TaskStatusCategory" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
    END IF;
END $$;

-- 2. The master --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "task_status" (
    "id"          TEXT NOT NULL,
    "code"        VARCHAR(40) NOT NULL,
    "label"       VARCHAR(80) NOT NULL,
    "meaning"     VARCHAR(200),
    "category"    "TaskStatusCategory" NOT NULL,
    "entityType"  VARCHAR(24) NOT NULL DEFAULT 'TASK',
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "isSystem"    BOOLEAN NOT NULL DEFAULT false,
    "sortOrder"   INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_status_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_status_code_key" ON "task_status"("code");
CREATE INDEX IF NOT EXISTS "task_status_entityType_isActive_sortOrder_idx"
    ON "task_status"("entityType", "isActive", "sortOrder");

-- 3. Seed the system rows ----------------------------------------------------
-- isSystem means permanent: they may be relabelled or deactivated, never
-- deleted, because historical tasks point at them.
INSERT INTO "task_status" ("id", "code", "label", "meaning", "category", "isSystem", "sortOrder", "updatedAt")
VALUES
  ('tskst_open',        'OPEN',        'Open',        'Not started yet.',                            'OPEN',        true, 10, CURRENT_TIMESTAMP),
  ('tskst_in_progress', 'IN_PROGRESS', 'In progress', 'Being worked on now.',                        'IN_PROGRESS', true, 20, CURRENT_TIMESTAMP),
  ('tskst_done',        'DONE',        'Done',        'Finished. No further action expected.',       'DONE',        true, 30, CURRENT_TIMESTAMP),
  ('tskst_cancelled',   'CANCELLED',   'Cancelled',   'Dropped deliberately. Not the same as done.', 'CANCELLED',   true, 40, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 4. Drop the partial index that depends on the enum -------------------------
-- `task_open_by_assignee_idx` carries the predicate
--   WHERE "deletedAt" IS NULL AND "status" IN ('OPEN','IN_PROGRESS')
-- compiled against the TaskStatus enum. Altering the column type makes Postgres
-- re-check that predicate and fail with
--   operator does not exist: character varying = "TaskStatus"
-- It has to go before the type change and come back after.
DROP INDEX IF EXISTS "task_open_by_assignee_idx";

-- 5. Convert the column in place ---------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task' AND column_name = 'status' AND data_type = 'USER-DEFINED'
    ) THEN
        ALTER TABLE "task" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "task" ALTER COLUMN "status" TYPE VARCHAR(40) USING "status"::text;
        ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'OPEN';
    END IF;
END $$;

-- 6. Recreate the index without the status predicate -------------------------
-- Deliberately no longer filtered on status codes. Which codes count as "open"
-- is now an administrator's decision, and a predicate listing OPEN and
-- IN_PROGRESS would silently exclude any status they add — the index would stop
-- covering the query it exists for, with nothing to show why.
CREATE INDEX IF NOT EXISTS "task_open_by_assignee_idx"
    ON "task" ("assigneeId", "dueAt")
    WHERE "deletedAt" IS NULL;

-- 7. Point tasks at the master -----------------------------------------------
-- Restrict on delete: a status in use cannot be removed. Deactivation is the
-- supported way to retire one, which keeps historical tasks readable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'task_status_fkey'
    ) THEN
        ALTER TABLE "task"
            ADD CONSTRAINT "task_status_fkey"
            FOREIGN KEY ("status") REFERENCES "task_status"("code")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "task_status_idx" ON "task"("status");

-- 8. The old enum is now unused ----------------------------------------------
DROP TYPE IF EXISTS "TaskStatus";
