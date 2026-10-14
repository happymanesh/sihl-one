-- Whether a client can take a product more than once.
--
-- A demat account is opened once; a fixed deposit or a mutual fund is taken
-- again and again. Defaulting to true is the harmless reading: every existing
-- product stays recurring, so nothing starts warning on the day this ships and
-- an administrator opts the one-time ones in deliberately.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "isRecurring" BOOLEAN NOT NULL DEFAULT true;
