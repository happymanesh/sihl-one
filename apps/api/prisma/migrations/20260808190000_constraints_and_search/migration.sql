-- ---------------------------------------------------------------------------
-- Constraints and indexes Prisma's schema language cannot express.
-- Hand-written and checked in so `migrate deploy` reproduces them exactly.
-- ---------------------------------------------------------------------------

-- Trigram matching. The CRM search box is "type any fragment of a name, phone
-- or reference"; a btree index cannot serve `ILIKE '%asha%'`, so without this
-- every keystroke is a sequential scan of the whole lead table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Duplicate-lead guard.
--
-- Business rule: one person (identified by mobile) may have at most one lead in
-- the *live* pipeline at a time. Re-enquiries attach to the existing lead. This
-- is what stops two RMs cold-calling the same person from two campaigns.
--
-- It has to be a partial index because the rule deliberately does not apply to
-- closed leads: someone who was lost last year may legitimately come back as a
-- new lead. A plain @@unique in Prisma would block that.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "lead_active_mobile_key"
    ON "lead" ("mobile")
    WHERE "deletedAt" IS NULL
      AND "status" NOT IN ('CONVERTED', 'LOST', 'DISQUALIFIED');

-- Same rule for PAN, which is the stronger identity key when we have it.
CREATE UNIQUE INDEX "lead_active_pan_key"
    ON "lead" ("pan")
    WHERE "pan" IS NOT NULL
      AND "deletedAt" IS NULL
      AND "status" NOT IN ('CONVERTED', 'LOST', 'DISQUALIFIED');

-- Search indexes.
CREATE INDEX "lead_search_name_trgm" ON "lead"
    USING gin (("firstName" || ' ' || COALESCE("lastName", '')) gin_trgm_ops);
CREATE INDEX "lead_mobile_trgm" ON "lead" USING gin ("mobile" gin_trgm_ops);
CREATE INDEX "lead_reference_trgm" ON "lead" USING gin ("reference" gin_trgm_ops);

CREATE INDEX "customer_search_name_trgm" ON "customer"
    USING gin (("firstName" || ' ' || COALESCE("lastName", '')) gin_trgm_ops);
CREATE INDEX "customer_mobile_trgm" ON "customer" USING gin ("mobile" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Soft-delete aware hot paths. Almost every list query carries
-- `deletedAt IS NULL`, so the partial indexes below are the ones actually used;
-- the full-table equivalents Prisma generated stay for the admin/report paths.
-- ---------------------------------------------------------------------------
CREATE INDEX "lead_live_pipeline_idx"
    ON "lead" ("ownerId", "status", "createdAt" DESC)
    WHERE "deletedAt" IS NULL;

CREATE INDEX "lead_followup_due_idx"
    ON "lead" ("nextFollowUpAt")
    WHERE "deletedAt" IS NULL AND "nextFollowUpAt" IS NOT NULL;

CREATE INDEX "task_open_by_assignee_idx"
    ON "task" ("assigneeId", "dueAt")
    WHERE "deletedAt" IS NULL AND "status" IN ('OPEN', 'IN_PROGRESS');

-- ---------------------------------------------------------------------------
-- A visit must be checked out after it was checked in, and a completed visit
-- must have both. Enforced in the database because visit records are evidence
-- of an RM's field activity and feed incentive calculations — an application
-- bug must not be able to write an incoherent one.
-- ---------------------------------------------------------------------------
ALTER TABLE "visit"
    ADD CONSTRAINT "visit_checkout_after_checkin"
    CHECK ("checkOutAt" IS NULL OR "checkInAt" IS NULL OR "checkOutAt" >= "checkInAt");

ALTER TABLE "visit"
    ADD CONSTRAINT "visit_completed_has_both_stamps"
    CHECK ("status" <> 'COMPLETED' OR ("checkInAt" IS NOT NULL AND "checkOutAt" IS NOT NULL));

-- Latitude/longitude must be real coordinates, not zeroes from a failed GPS fix.
ALTER TABLE "visit"
    ADD CONSTRAINT "visit_checkin_coords_valid"
    CHECK (
        ("checkInLatitude" IS NULL AND "checkInLongitude" IS NULL)
        OR ("checkInLatitude" BETWEEN -90 AND 90 AND "checkInLongitude" BETWEEN -180 AND 180)
    );

-- ---------------------------------------------------------------------------
-- A lead marked LOST must carry a reason. The API validates this too; the
-- constraint means an import script or a manual fix cannot bypass it, and
-- lost-reason analytics never has to handle nulls.
-- ---------------------------------------------------------------------------
ALTER TABLE "lead"
    ADD CONSTRAINT "lead_lost_requires_reason"
    CHECK ("status" <> 'LOST' OR "lostReason" IS NOT NULL);

-- Score is a percentage.
ALTER TABLE "lead"
    ADD CONSTRAINT "lead_score_range" CHECK ("score" BETWEEN 0 AND 100);

-- Money is never negative in this system.
ALTER TABLE "lead"
    ADD CONSTRAINT "lead_estimated_value_non_negative"
    CHECK ("estimatedValue" IS NULL OR "estimatedValue" >= 0);

ALTER TABLE "partner"
    ADD CONSTRAINT "partner_commission_rate_range"
    CHECK ("commissionRate" IS NULL OR ("commissionRate" >= 0 AND "commissionRate" <= 100));
