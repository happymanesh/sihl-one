# Production readiness checklist

> **Status, August 2026:** see [release readiness](release-readiness.md) for what is verified
> today and what remains. In short: access control, authentication and data handling are tested;
> penetration testing, dependency scanning, static analysis, load testing and a retention policy
> are not started, and those four are the gate between internal UAT and real customer data.


Phases 1 and 2 are working, verified vertical slices. Together they are **not**
production-ready for a SEBI-regulated broker. This is the honest gap list.

Items marked **BLOCKER** must be closed before any real customer data enters the system.

---

## Security

- [x] Argon2id password hashing with a server-side pepper
- [x] Opaque rotating refresh tokens with reuse detection
- [x] Account lockout after 5 failed attempts
- [x] Uniform login failure messages (no account enumeration)
- [x] RBAC on every endpoint; ABAC on every query
- [x] Out-of-scope records return 404, not 403
- [x] Append-only audit trail with PII redaction
- [x] Rate limiting, global and per-endpoint
- [x] Security headers (helmet, CSP, HSTS, frame-deny)
- [x] Tokens in httpOnly cookies, never `localStorage`
- [x] Upload allow-list plus magic-number content sniffing
- [x] Uploads served as attachments with nosniff, never rendered in our origin
- [x] Short-lived, user-bound, constant-time-verified download grants
- [x] Unscanned files are not downloadable (reported, not silently hidden)
- [ ] **BLOCKER** MFA for all internal and partner users (schema ready, flow not built)
- [ ] **BLOCKER** Secrets moved to a managed vault; no secret in any file on disk
- [ ] **BLOCKER** `audit_log` granted only `INSERT`/`SELECT` to the runtime DB role
- [ ] **BLOCKER** Independent penetration test, findings closed
- [ ] **BLOCKER** Real malware scanner (ClamAV or equivalent) wired to the `FileScanner` seam
- [ ] **BLOCKER** `STORAGE_DRIVER=s3` with server-side encryption and lifecycle rules
- [ ] Encryption at rest confirmed (disk plus column-level for PAN)
- [ ] TLS 1.3 only; certificate rotation automated
- [ ] Session device management surfaced in the UI (API exists at `/users/me/sessions`)
- [ ] Anti-automation on public lead capture beyond rate limiting
- [ ] Dependency scanning and SBOM in the release pipeline

## Regulatory and data protection

- [ ] **BLOCKER** DPDP Act review: consent wording, purposes, retention, grievance officer
- [ ] **BLOCKER** Data retention and deletion policy implemented, not just written
- [ ] **BLOCKER** SEBI/CERT-In incident reporting runbook (6-hour reporting obligation)
- [ ] **BLOCKER** Data residency confirmed — all data and backups in India
- [ ] Right-to-erasure flow that respects regulatory retention overrides
- [ ] Consent withdrawal honoured by every outbound channel
- [ ] Audit retention aligned to the regulatory minimum (typically 8 years)
- [ ] **BLOCKER** DPIA completed for the geo-tagged visit module before field rollout
- [ ] Retention period agreed for visit location data and check-in photographs
- [ ] Field staff notified in writing of exactly what the visit module records

## Reliability

- [x] Liveness and readiness probes, correctly separated
- [x] Graceful shutdown (tini + Nest shutdown hooks)
- [x] Transactional outbox so events survive a crash
- [x] Outbox relay with backoff, dead-lettering and SKIP LOCKED claiming
- [ ] **BLOCKER** Alerting on outbox `pending` growth and any `deadLettered` row
- [ ] **BLOCKER** Backups with a *restore* rehearsed end to end
- [ ] Documented RPO/RTO agreed with the sponsor
- [ ] Connection-pool sizing validated against `max_connections` for the pod count
- [ ] Load test at 5× expected peak
- [ ] Idempotency keys on externally-triggered writes

## Observability

- [ ] **BLOCKER** Centralised structured logging with the trace id propagated
- [ ] OpenTelemetry traces across web → API → database
- [ ] Prometheus metrics: latency, error rate, saturation, queue depth
- [ ] Dashboards and alerts with named owners
- [ ] Alert on `syncedAt` staleness for mirrored back-office data
- [ ] Alert on audit-write failures (currently logged at error, unmonitored)

## Data and integrations

- [ ] **BLOCKER** Real back-office integration replacing mirrored placeholders
- [ ] **BLOCKER** Real eKYC/onboarding integration consuming `lead.converted`
- [ ] Reconciliation job proving the mirror matches the source
- [ ] WhatsApp/SMS/email providers behind the `sendMessage()` seam
- [ ] Payment gateway (Phase 4, if in scope)

## Quality

- [x] 137 automated tests passing (contract, unit, e2e)
- [x] CI: typecheck, lint, unit, migrations, seed, e2e, production build, audit
- [x] Schema/migration drift check in CI
- [ ] Coverage thresholds enforced
- [ ] Accessibility audit against WCAG 2.2 AA
- [ ] Cross-browser and real-device testing (low-end Android especially)
- [ ] Visual regression tests for the design system

## Operations

- [ ] **BLOCKER** Runbooks: deploy, rollback, incident, restore
- [ ] Zero-downtime deployment with a tested rollback
- [ ] Migration strategy for non-additive changes (expand/contract)
- [ ] Environment parity: dev, UAT, production
- [ ] On-call rota and escalation path
- [ ] User training and change-management plan for ~500 users

---

## Recommended sequencing

1. **Before UAT** — MFA, secrets vault, centralised logging, backup/restore rehearsal.
2. **Before pilot with real customer data** — DPDP review, retention policy, pen test,
   audit-table grants, real integrations.
3. **Before full rollout** — load testing, accessibility audit, runbooks, training.
