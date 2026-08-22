# ClamAV — upload scanning

Runs the official `clamav/clamav:stable` image unmodified. There is no
Dockerfile here on purpose: an earlier version of this directory carried one
that set `TCPAddr ::`, on the assumption that clamd would bind IPv4 only and be
unreachable over Railway's IPv6-only private network. That turned out to be
unnecessary — the stock image listens on both — and a Dockerfile that is not
what runs in production is worse than no Dockerfile at all.

## The service

Created on Railway as a service named `clamav`, sourced directly from the public
image:

```bash
railway add --service clamav
railway service source connect --image clamav/clamav:stable --service clamav
```

**It has no public domain, and must never be given one.** clamd accepts
arbitrary bytes from anyone who can reach it and is not built to face the
internet. It is reachable only at `clamav.railway.internal:3310`, and the API is
its only client.

Startup takes 30–60 seconds: clamd loads roughly 3.3 million signatures into
memory before it accepts connections. Expect scans to fail — never to pass —
during that window, and for a minute after each redeploy.

## Wiring the API to it

On the `api` service:

| Variable | Value |
| --- | --- |
| `FILE_SCANNER_MODE` | `clamav` |
| `CLAMAV_HOST` | `clamav.railway.internal` |
| `CLAMAV_PORT` | `3310` (default) |
| `CLAMAV_TIMEOUT_MS` | `30000` (default) |

The configuration validator refuses `FILE_SCANNER_MODE=clamav` without
`CLAMAV_HOST`, so a half-configured deployment fails at boot rather than marking
every upload unscanned and being discovered weeks later.

## Cost

This is the expensive part of the setup. clamd holds its signature database in
memory — on the order of 1.5–2 GB, resident, permanently, whether or not anyone
uploads anything. On Railway's usage-based pricing that is the largest single
line item in this project. Worth knowing before it is added to a second
environment.

## Verifying it

Upload the EICAR test string inside a PDF. It is the industry-standard harmless
test file, not malware, and every scanner detects it:

```
%PDF-1.4
4 0 obj<</Length 68>>stream
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
endstream
```

A working scanner answers `400 File rejected`. A clean file returns
`scanStatus: CLEAN`. If a clean file comes back `FAILED`, the API cannot reach
clamd — check the private hostname before anything else.

Note that EICAR spliced into the middle of a JPEG is **not** detected: the
signature is anchored, so that test passes silently and proves nothing. Put it
in a PDF stream or a plain file.
