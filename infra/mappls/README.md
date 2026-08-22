# Mappls — the address on a check-in photo

Reverse geocoding, so a visit photo carries a street address as well as
coordinates and a timestamp. Requested by the Chief Business Development
Officer, who supplied a GPS Map Camera screenshot as the reference.

**It is switched off until credentials exist.** With no geocoder configured the
stamp reads coordinates and time, which is a complete record — the address is an
improvement, not a requirement, and nothing in the check-in path waits on it.

## Why Mappls and not Google

Address quality outside the metros, which is where most SIHL branches are, and
the fact that a rep's precise location stays with an Indian company. The second
point is the easier answer if the question is ever asked formally.

## Turning it on

Obtain OAuth client credentials from the Mappls console, then set these on the
`api` service — **not** on `web`, and never in any file the browser receives:

| Variable | Value |
| --- | --- |
| `GEOCODER` | `mappls` |
| `MAPPLS_CLIENT_ID` | from the Mappls console |
| `MAPPLS_CLIENT_SECRET` | from the Mappls console |
| `MAPPLS_TOKEN_URL` | defaults to `https://outpost.mappls.com/api/security/oauth/token` |
| `MAPPLS_REVERSE_URL` | defaults to `https://apis.mappls.com/advancedmaps/v1/rev_geocode` |
| `GEOCODER_TIMEOUT_MS` | defaults to `4000` |

The configuration validator refuses `GEOCODER=mappls` without both credentials,
so a half-configured deployment fails at boot rather than silently stamping no
addresses for a month.

**Confirm both URLs against your account's documentation before switching this
on.** They are configurable precisely because Mappls has moved its API host more
than once, and because these defaults were written without an account to verify
them against. If the token request or the lookup returns 404, the URL is the
first thing to check — the code will report it as "no address" rather than
failing, so nothing breaks, but nothing works either.

## How to tell whether it is working

```
GET /api/v1/geo/reverse?lat=23.0225&lng=72.5714
```

- `{"address": null, "provider": "disabled"}` — no geocoder configured.
- `{"address": null, "provider": "mappls"}` — configured but the provider did
  not answer. Check the API logs; every failure is logged with its cause.
- `{"address": "…", "provider": "mappls"}` — working.

## Cost control

The key never reaches the browser. Requests go through the API, which is
throttled to 60 lookups per user per minute, and results are cached for a day
against coordinates rounded to about eleven metres — so several reps checking in
at the same branch, or one rep retaking a photo, cost a single lookup rather
than one each.

## What is stored

The resolved address is burnt into the photo and saved on the visit's
`checkInAddress` column. The image is what a person reads on a printout; the
column is what a report can group by. Coordinates remain the authoritative
record of where the rep was — the address is a rendering of them, and a stamp
drawn in a browser is a caption rather than evidence.
