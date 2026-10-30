-- The question bank: sets, questions, and a wording per language.
--
-- A question is one thing asked in several languages, not several questions.
-- The answer key, the marks and the product sit on "question"; only the
-- wording varies, in "question_translation". That is what lets one answer key
-- serve every language and makes it impossible for the Hindi and the English
-- to disagree about which option is right.
--
-- Idempotent throughout, because a Prisma multi-statement migration is not
-- transactional: a failure halfway must leave something a re-run can finish.
CREATE TABLE IF NOT EXISTS "question_set" (
  "id"          TEXT         NOT NULL,
  "name"        VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "productId"   TEXT         NOT NULL,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_set_pkey" PRIMARY KEY ("id")
);

-- One set of a given name per product: "AML — basics" means one thing under
-- Equity and may mean another under Mutual Funds, but not two things under
-- either.
CREATE UNIQUE INDEX IF NOT EXISTS "question_set_productId_name_key"
  ON "question_set" ("productId", "name");
CREATE INDEX IF NOT EXISTS "question_set_productId_idx"
  ON "question_set" ("productId");

CREATE TABLE IF NOT EXISTS "question" (
  "id"             TEXT          NOT NULL,
  "productId"      TEXT          NOT NULL,
  "questionSetId"  TEXT,
  "sourceLanguage" VARCHAR(5)    NOT NULL DEFAULT 'EN',
  "correctAnswer"  VARCHAR(1)    NOT NULL,
  "marks"          DECIMAL(6, 2) NOT NULL DEFAULT 1,
  "negativeMarks"  DECIMAL(6, 2) NOT NULL DEFAULT 0,
  "isActive"       BOOLEAN       NOT NULL DEFAULT true,
  "createdById"    TEXT          NOT NULL,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "question_pkey" PRIMARY KEY ("id")
);

-- The index the bank screen and the "have we enough to build this test"
-- count both read: questions for a product that are not retired.
CREATE INDEX IF NOT EXISTS "question_productId_isActive_idx"
  ON "question" ("productId", "isActive");
CREATE INDEX IF NOT EXISTS "question_questionSetId_idx"
  ON "question" ("questionSetId");

CREATE TABLE IF NOT EXISTS "question_translation" (
  "id"           TEXT          NOT NULL,
  "questionId"   TEXT          NOT NULL,
  "language"     VARCHAR(5)    NOT NULL,
  "text"         VARCHAR(2000) NOT NULL,
  "optionA"      VARCHAR(500)  NOT NULL,
  "optionB"      VARCHAR(500)  NOT NULL,
  "optionC"      VARCHAR(500)  NOT NULL,
  "optionD"      VARCHAR(500)  NOT NULL,
  "explanation"  VARCHAR(2000),
  "status"       VARCHAR(10)   NOT NULL DEFAULT 'APPROVED',
  "approvedById" TEXT,
  "approvedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "question_translation_pkey" PRIMARY KEY ("id")
);

-- One wording per language per question. This is the constraint that makes
-- "the Hindi of this question" a single, unambiguous thing rather than
-- whichever of two rows was written last.
CREATE UNIQUE INDEX IF NOT EXISTS "question_translation_questionId_language_key"
  ON "question_translation" ("questionId", "language");
-- Drives "which questions can this Gujarati test actually draw on", which
-- filters on language and status together.
CREATE INDEX IF NOT EXISTS "question_translation_language_status_idx"
  ON "question_translation" ("language", "status");

DO $$
BEGIN
  -- Restrict on product: a product with questions written against it is not
  -- one to delete by accident, and the questions would be orphaned.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_set_productId_fkey') THEN
    ALTER TABLE "question_set" ADD CONSTRAINT "question_set_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_set_createdById_fkey') THEN
    ALTER TABLE "question_set" ADD CONSTRAINT "question_set_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_productId_fkey') THEN
    ALTER TABLE "question" ADD CONSTRAINT "question_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Dissolving a set must not take its questions with it: they go back to
  -- being loose questions under the same product, which is recoverable.
  -- Losing them would not be.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_questionSetId_fkey') THEN
    ALTER TABLE "question" ADD CONSTRAINT "question_questionSetId_fkey"
      FOREIGN KEY ("questionSetId") REFERENCES "question_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_createdById_fkey') THEN
    ALTER TABLE "question" ADD CONSTRAINT "question_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Cascade here, and only here: a wording has no meaning without the
  -- question it words. Deleting a question is already refused once any test
  -- has frozen a copy of it, so this cannot reach anything a result depends on.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_translation_questionId_fkey') THEN
    ALTER TABLE "question_translation" ADD CONSTRAINT "question_translation_questionId_fkey"
      FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- The approver may leave; the approval stands. Who signed it off is nulled
  -- rather than blocking the offboarding of a compliance officer.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_translation_approvedById_fkey') THEN
    ALTER TABLE "question_translation" ADD CONSTRAINT "question_translation_approvedById_fkey"
      FOREIGN KEY ("approvedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
