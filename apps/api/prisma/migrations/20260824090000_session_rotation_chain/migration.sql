-- Let a rotated refresh token be followed forward instead of read as theft.
--
-- The web middleware redirects any protected request without an access cookie
-- to /auth/refresh. A page load fires several such requests at once, so the
-- first rotated the refresh token and the rest presented the token it had just
-- replaced. Refresh treated that as reuse and revoked every session the user
-- had — the entire team signed out, mid-task, roughly fifteen minutes after
-- signing in. The production API log shows the signature clearly: four
-- `POST /auth/refresh -> 401` within the same second.
--
-- Recording which session replaced which turns that race into something
-- recoverable: a token presented moments after its own rotation is followed to
-- the live session. Genuine reuse — an old token surfacing long afterwards —
-- still trips detection and still revokes everything.
--
-- Nullable and additive, so existing sessions are unaffected and nobody is
-- signed out by this migration. Guarded, because Prisma does not wrap a
-- multi-statement migration in one transaction.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'session' AND column_name = 'replacedById'
    ) THEN
        ALTER TABLE "session" ADD COLUMN "replacedById" VARCHAR(30);
    END IF;
END $$;
