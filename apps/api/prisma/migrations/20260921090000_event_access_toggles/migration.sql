-- Who may see events, decided by hierarchy level and by branch.
--
-- Two switches rather than one, because the business asks the question in two
-- dimensions: "which levels should ever see this" and "which offices are
-- running events". Access is the AND of the two, so switching a level on does
-- nothing until a branch is switched on as well, and switching a branch off
-- withdraws it from everyone there in one action.
--
-- Default false on both. A permission that arrived switched on would silently
-- widen what every existing user can see the moment this deploys, which is the
-- opposite of what a permission toggle is for.
--
-- Column names are camelCase to match every other column in this database.
-- The table names are snake_case; the columns are not, and a migration that
-- mixes the two produces a schema Prisma can only reach through @map.
--
-- Multi-statement Prisma migrations are not transactional, so every statement
-- here is safe to run twice.

ALTER TABLE "designation"
  ADD COLUMN IF NOT EXISTS "canAccessEvents" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "org_unit"
  ADD COLUMN IF NOT EXISTS "canAccessEvents" BOOLEAN NOT NULL DEFAULT false;

-- The rep whose personal QR produced a lead.
--
-- Distinct from "ownerId": the owner is where the lead ended up and moves with
-- a transfer, while this records who brought it in and must not. Without the
-- separation, one reassignment quietly rewrites the event's attribution and
-- nobody can tell afterwards whose QR actually worked.
ALTER TABLE "lead"
  ADD COLUMN IF NOT EXISTS "capturedById" TEXT;

DO $$
BEGIN
  ALTER TABLE "lead"
    ADD CONSTRAINT "lead_capturedById_fkey"
    FOREIGN KEY ("capturedById") REFERENCES "app_user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Event reporting reads this per event, grouped by rep.
CREATE INDEX IF NOT EXISTS "lead_eventId_capturedById_idx"
  ON "lead" ("eventId", "capturedById");
