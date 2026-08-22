-- One employee code, one person.
--
-- The application has always checked this on create and update, but nothing in
-- the database enforced it: two administrators acting at the same moment, or
-- any future import, could still produce two people sharing a code. Since the
-- code is now something a person signs in with, a duplicate stops being an
-- untidy record and becomes an ambiguous login.
--
-- Partial, for two reasons. NULL is common and legitimate — most existing users
-- have no code — and soft-deleted users must not hold a code hostage, which
-- matches the rule assertEmployeeCodeFree already applies in the service.
--
-- Note the table name: the Prisma model `User` maps to "app_user".

-- 1. Refuse to proceed on data this constraint cannot describe ---------------
-- Without this the failure is `duplicate key value violates unique constraint`
-- naming an index nobody has heard of. With it, the deploy log names the codes
-- and how many people hold each one.
DO $$
DECLARE
    clash TEXT;
BEGIN
    SELECT string_agg(t.code || ' (' || t.n || ' users)', ', ')
      INTO clash
      FROM (
        SELECT "employeeCode" AS code, COUNT(*) AS n
          FROM "app_user"
         WHERE "employeeCode" IS NOT NULL AND "deletedAt" IS NULL
         GROUP BY "employeeCode"
        HAVING COUNT(*) > 1
      ) t;

    IF clash IS NOT NULL THEN
        RAISE EXCEPTION
            'Employee codes are shared by more than one active user: %. Resolve these before deploying.',
            clash;
    END IF;
END $$;

-- 2. The constraint -----------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "app_user_employeeCode_key"
    ON "app_user" ("employeeCode")
    WHERE "employeeCode" IS NOT NULL AND "deletedAt" IS NULL;

-- 3. The login lookup ---------------------------------------------------------
-- Sign-in now matches email, mobile or employee code. The unique index above
-- already serves the code lookup, so nothing further is needed here — this note
-- exists so the next person does not add a redundant one.
