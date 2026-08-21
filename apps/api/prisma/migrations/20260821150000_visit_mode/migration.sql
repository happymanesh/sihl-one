-- A planned engagement records how it will happen.
--
-- Requested by the Chief Business Development Officer: planning is done in one
-- place, whether the rep is driving to a client's premises, dialling them, or
-- sending a video link. The mode then decides what evidence check-in asks for —
-- a photograph outside a client's office is evidence, the same photograph at
-- your own desk before a phone call is theatre.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration
-- in one transaction, so a failure part-way leaves the earlier statements
-- applied and an unguarded retry then fails on "already exists".
--
-- Note the table name: the Prisma model `Visit` maps to "visit", and
-- `MeetingModeMaster` maps to "meeting_mode".

-- 1. The column ---------------------------------------------------------------
-- Defaulted rather than nullable. Every visit that already exists was made
-- under the old rules, where the only kind of visit was a physical one at the
-- client's premises — so CLIENT_SITE is not a guess, it is what they were.
ALTER TABLE "visit" ADD COLUMN IF NOT EXISTS "mode" VARCHAR(40) NOT NULL DEFAULT 'CLIENT_SITE';

-- 2. Backfill any row that predates the default -------------------------------
-- Belt and braces: ADD COLUMN ... DEFAULT already backfills in modern Postgres,
-- but a column added by an earlier partial run would not have been.
UPDATE "visit" SET "mode" = 'CLIENT_SITE' WHERE "mode" IS NULL;

-- 3. Point it at the master ---------------------------------------------------
-- RESTRICT, so a mode that visits refer to cannot be deleted out from under
-- them. Deactivation is the supported way to retire one, which keeps historical
-- visits readable. CASCADE on update so a renamed code follows.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_mode_fkey') THEN
        ALTER TABLE "visit"
            ADD CONSTRAINT "visit_mode_fkey"
            FOREIGN KEY ("mode") REFERENCES "meeting_mode"("code")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Reporting reads this constantly ------------------------------------------
-- "Field visits this month" must be able to exclude calls and chats without
-- scanning the table, otherwise every field-activity report degrades as the
-- book grows.
CREATE INDEX IF NOT EXISTS "visit_mode_idx" ON "visit"("mode");
