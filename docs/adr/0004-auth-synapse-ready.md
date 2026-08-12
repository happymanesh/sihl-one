# ADR-0004 — Own the tokens now, be ready for Synapse

**Status:** Accepted · 2026-08-09

## Context

SIHL Synapse is being built as the central identity layer for internal users. SIHL ONE also
serves customers and external partners, who will never exist in Synapse's HR-sourced
directory. Phase 1 must ship standalone and demoable.

## Decision

SIHL ONE issues and verifies its own tokens in Phase 1, but **all token knowledge is confined
to `TokenService`**. When Synapse becomes the issuer, `verifyAccessToken` changes to validate
Synapse-signed RS256 tokens against its JWKS and `issueAccessToken` disappears for internal
users. Nothing else in the codebase moves, because every caller depends on that interface
rather than on a JWT library.

`IDENTITY_PROVIDER` (`local` | `synapse`) is already part of the validated environment.

## Design details and their reasons

- **Argon2id, not bcrypt.** bcrypt silently truncates at 72 bytes and has no memory cost, so
  it is cheap to attack with commodity GPUs. `@node-rs/argon2` ships prebuilt binaries, so no
  node-gyp toolchain is needed on a build agent.
- **A server-side pepper**, held in the secrets manager and never in the database, so a stolen
  database dump alone cannot be cracked offline.
- **Refresh tokens are opaque random strings, not JWTs.** A JWT refresh token stays valid
  until it expires even after the user hits "sign out everywhere". An opaque token is valid
  only while its hash is present and unrevoked in the session table, so revocation is
  immediate — which is the entire point of having one.
- **Only the SHA-256 of the refresh token is stored.** SHA-256 rather than Argon2 because the
  input is 384 bits of entropy: there is nothing to brute-force, and this runs on every
  refresh.
- **Rotation with reuse detection.** Presenting an already-rotated token revokes every session
  for that user, on the assumption that the token leaked.
- **Uniform login failure message.** Unknown account, wrong password and suspended account are
  indistinguishable, and a dummy hash is computed on the unknown-account path so the response
  timing matches too. For a broker, a login form that confirms who holds a demat account is
  itself a data leak.
- **Tokens live in httpOnly cookies**, set by server actions. `localStorage` is readable by any
  script on the page, so one XSS or one compromised dependency hands over a live session.
- **Symmetric HS256 while we are our own issuer.** There is exactly one verifier, so
  asymmetric keys would buy nothing but key management.

## Consequences

- Phase 1 ships without depending on Synapse's timeline.
- Customers and partners keep local authentication permanently; only internal users migrate.
- MFA is schema-ready (`mfaEnabled`, `mfaSecret`) but unimplemented — a blocker on the
  production checklist for any external-facing rollout.
