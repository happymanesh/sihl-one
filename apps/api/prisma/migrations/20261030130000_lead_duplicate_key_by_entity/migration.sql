-- The duplicate-lead guard, keyed on entity type as well as mobile.
--
-- `lead_active_mobile_key` allowed one live lead per mobile number, full stop.
-- That is right for two reps cold-calling the same person from two campaigns,
-- which is what it was built for, and wrong for an HUF: a different legal
-- entity, with its own PAN and its own account, that routinely shares the
-- karta's number. The second account could not be opened at all while the
-- first lead was live, and no amount of service-level change could help —
-- the database refused the insert.
--
-- The rule is otherwise unchanged. One live lead per person *per kind of
-- account*; closed leads are still exempt, so somebody lost last year can
-- come back.
--
-- PAN keeps its own unquantified guard: two entities never share a PAN, so
-- `lead_active_pan_key` stays exactly as it is and remains the stronger
-- identity check wherever a PAN is known.
--
-- Idempotent, because a Prisma multi-statement migration is not transactional.

DROP INDEX IF EXISTS "lead_active_mobile_key";

CREATE UNIQUE INDEX IF NOT EXISTS "lead_active_mobile_entity_key"
    ON "lead" ("mobile", "entityType")
    WHERE "deletedAt" IS NULL
      AND "status" NOT IN ('CONVERTED', 'LOST', 'DISQUALIFIED');
