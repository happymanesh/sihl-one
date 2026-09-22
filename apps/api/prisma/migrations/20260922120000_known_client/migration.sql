-- A stand-in for the back office, until there is an interface to it.
--
-- SIHL ONE cannot currently tell an existing client from a stranger: it knows
-- only the people who have already been leads here. Somebody who has held an
-- account for ten years but never filled in this form registers at a stall as a
-- brand new enquiry, and the rep pitches account opening to a client.
--
-- This table is where that list lives in the meantime. Rows are inserted by
-- hand; the lookup that reads it is a single service method, so when the back
-- office exposes an API the query is replaced and nothing else moves.
--
-- Additive: creates one table and touches nothing that exists.

CREATE TABLE IF NOT EXISTS "known_client" (
  -- Defaulted in the database, not the application, so a row can be added with
  -- nothing but a mobile number:
  --   INSERT INTO known_client (mobile) VALUES ('9876543210');
  -- A stop-gap that needs an application to write to it is not a stop-gap.
  "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "mobile"     VARCHAR(10)  NOT NULL,
  -- Everything below is optional. The mobile is the only thing the match needs;
  -- the rest is for whoever has to reconcile this against the real book later.
  "clientCode" VARCHAR(32),
  "fullName"   VARCHAR(120),
  "note"       VARCHAR(255),
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "known_client_pkey" PRIMARY KEY ("id"),

  -- The whole value of this table is that a lookup matches. Mobiles are stored
  -- everywhere else as a bare ten digits, so a row typed as '+919876543210' or
  -- '09876543210' would sit here looking correct and never match anything.
  -- Failing the insert is far better than a silent miss at a stall.
  CONSTRAINT "known_client_mobile_format" CHECK ("mobile" ~ '^[6-9][0-9]{9}$')
);

-- One row per number, and the index the lookup runs on.
CREATE UNIQUE INDEX IF NOT EXISTS "known_client_mobile_key" ON "known_client" ("mobile");
