# Architecture & Decisions

A living record of the architectural decisions, why each was made, and the privacy
posture of the system. Update it when a decision changes.

## Services

```
 Browser ──(same-origin /api + /socket.io)──▶ backend (Express 5, :4000)
                                               │  Prisma, as role lms_app → RLS enforced
                                               ├──────────────▶ Postgres 16
                                               │  REST + X-Internal-Token
                                               └──────────────▶ ml-service (FastAPI, :8000)
                                                                 stateless, no DB access
```

| Service | Stack | Owns |
|---|---|---|
| `frontend` | React 19, Vite 7, Tailwind 4, Motion, Recharts, TanStack Query, Radix | UI, webcam capture, browser-side proctoring signals, PWA |
| `backend` | Node 24, Express 5, Prisma 6, Zod 4, Socket.IO | Auth/RBAC, tenancy, LMS domain, analytics, orchestration, jobs |
| `ml-service` | Python 3.12, FastAPI, MediaPipe 1.x, scikit-learn | Adaptive assessment, recommendations, frame analysis |
| `postgres` | PostgreSQL 16 | All persistent state |

The ml-service is **stateless**: the backend sends everything it needs and persists
the results, so ML can be swapped, scaled or moved to GPU hosts independently. When
it is unavailable, the backend degrades gracefully: recommendations fall back to
course order, and proctoring falls back to browser-only signals.

### Backend layout

```
src/
  lib/          db (withTenant/withSystem), tokens, password, events, mlClient, storage
  middleware/   authenticate, requireRole, error mapping
  modules/      auth, users, tenants, courses, cognitive, recommendations, exams,
                proctoring, analytics, gamification, engagement, forum, assignments
  jobs/         analytics snapshots + proctoring retention (hourly, idempotent)
  realtime/     Socket.IO rooms: user:<id>, tenant:<id>:staff
```

Domain events (`lib/events.ts`) are emitted **after** a transaction commits;
gamification, realtime and notifications subscribe to them.

## Decision log

### ADR-1: Row-level tenancy enforced by Postgres RLS
Every tenant-owned table has `tenant_id`. Each request's queries run inside
`withTenant(tenantId, tx => …)`, which does `set_config('app.tenant_id', …, true)`
(transaction-local, so it can't leak across pooled connections). RLS policies allow a
row only when `tenant_id = app_current_tenant()`, for reads **and** writes (`WITH
CHECK`). The backend connects as `lms_app` (not owner, `NOBYPASSRLS`); migrations run
as the owner. A vetted `withSystem()` bypass exists only for signup, super-admin views,
jobs and seeding. Tested in `backend/tests/rls.test.ts`: no rows visible without
context, no cross-tenant insert/update/move, no context leaks across the pool, and
`lms_app` can't disable RLS.

*Rejected:* schema-per-tenant (N× migrations, poor Prisma support, cross-schema analytics).

### ADR-2: Proctoring = server-side inference, events-only storage
The browser samples a 320-px JPEG about every 2 s. The backend holds it in memory
(multer memoryStorage) and forwards it to the ml-service, where it is decoded, analyzed
and dropped. It is never written to disk, the database or logs. The ml-service returns
`{faces, lookingAway, confidence, …}`, and a per-session `SessionTracker` turns noisy
frames into **durational** events that only open once a signal persists (no face ≥ 4 s,
looking away ≥ 5 s, a second face ≥ 2 s) and close after 2 clear frames. Browser
signals (tab hidden, focus lost, full-screen exit, copy/paste, camera lost) are
posted as intervals. On submit, `summarize()` applies tolerant review rules and marks
the attempt `PENDING` review only if thresholds are crossed. Instructors see a
timeline, a table and neutral wording, and record a decision.

*Rejected:* snapshot-on-flag, client-side inference (tamperable), full video.

### ADR-3: No deep-learning framework in v1
MediaPipe FaceLandmarker (Tasks API) supplies landmarks (with irises) and a facial
transformation matrix, and head pose is derived from its rotation. The recommender is
rule-based behind a `Recommender` protocol with a registry; the backend logs every
suggestion and whether it was followed, which is a ready-made training set for a
learned ranker (PyTorch or gradient boosting) to plug in later with no API change.

### ADR-4: Pinned, proven dependency lines
At project start npm's `latest` pointed at Prisma 8 (RC) and TypeScript 7. We pinned
Prisma 6, TypeScript 5.9, Vite 7, Vitest 4 and React Router 7.
**Zod 4 gotcha:** `.partial()` still applies `.default()` values, so PATCH schemas are
built from default-free base schemas (regression-tested in `courses.test.ts`).

### ADR-5: Adaptive assessment, stateless and tamper-proof
16 items: 3 preference, 10 diagnostic (5 topics × 2, a two-step staircase: medium,
then harder or easier), and 3 reasoning. The backend sends the full history on every
call; the engine **replays** it and rejects any response that doesn't match the item it
would have asked. Mastery per topic comes from a Rasch model (MAP with an N(0,1)
prior; answers under 1.5 s are down-weighted as rapid guesses). Calibration =
mean(correct − confidence). The summary uses preference and "right now" language,
never fixed traits.

### ADR-6: Explainable recommendations
Score = weighted sum of: weakest-topic gap (profile blended with recent exam results,
exams weighted 0.6), difficulty fit (target rises with mastery, shifted by pace),
continuity (in-progress first, then course order), modality preference, growth
area, and freshness (rotating out ignored suggestions). Greedy topic diversity breaks
near-ties. Every item returns its top reasons, which appear in the UI as
"Why this?".

### ADR-7: Analytics = live queries + nightly snapshots
Dashboards use tenant-scoped SQL (still under RLS) bucketed in the **viewer's
timezone** (validated IANA names). An hourly job backfills missing daily per-tenant
snapshots idempotently, and the admin trend reads those. At-risk detection is
rule-based with human-readable reasons (inactivity, behind the class median, failing
latest exam, dropping scores).

### ADR-8: Realtime as cache invalidation
Socket.IO pushes *hints* (`analytics:changed`, `progress:changed`, `review:pending`,
`notification`) that invalidate React Query caches, so the server stays the single
source of truth. Rooms are tenant-namespaced, and staff rooms only admit staff roles
verified from the access token. Bursts are coalesced to 1 ping per tenant per 3 s.
Multi-replica deployments need the Socket.IO Redis adapter and a shared tracker store.

## Security notes

- Access tokens: 15-min JWT, memory-only on the client. Refresh tokens: 7-day JWT in
  an httpOnly `SameSite=Strict` cookie scoped to `/api/auth`, rotated on every use;
  **reuse of a rotated token revokes the whole family**.
- Passwords: scrypt (N=2^14) with per-user salt; login does equal work for unknown
  accounts (no user enumeration by timing); credential endpoints are rate limited.
- Uploads: MIME allow-list, size limit, opaque storage keys, path-traversal guard,
  `Content-Disposition: attachment` + `nosniff` on download.
- Hidden resources return 404 (not 403) to students, and authorization runs before
  validation, so error responses don't reveal draft courses.
- Markdown is rendered without raw HTML.

## Privacy & compliance

Flagged for whoever deploys this for a real institution (FERPA, GDPR and local
equivalents). What the code already does, and what remains an institutional decision:

**Webcam / proctoring**
- ✅ Explicit consent screen before the camera starts: what is analyzed, what is
  stored (events only), retention, who sees it, and how to request an alternative.
  The API refuses a proctored attempt without `consent: true`.
- ✅ No images or video stored; frames never touch disk or logs.
- ✅ Retention: an hourly job deletes events older than the tenant's
  `proctoringRetentionDays` (default 30).
- ✅ Flags are signals for **human** review. The UI states that signals can be wrong
  and uses neutral language; thresholds require persistence and are tolerant.
- ✅ Students are told transparently when an attempt was noted for review.
- ⚠️ Institutional decision: the alternative-arrangement process for students who
  can't or won't use a camera, and a documented bias review (face detection accuracy
  varies with skin tone, lighting, eyewear and disability; "no face" must never
  auto-fail).

**Cognitive profiling**
- ✅ Used only to personalize ordering and suggestions; never for grades.
- ✅ Visible to the student and their institution's staff only (RLS).
- ✅ Students can retake it or **delete the profile and every stored answer**.
- ✅ Consent-style intro before starting; framed as current preferences and skills.

**Offline cache (PWA)**
- Course content is cached network-first for offline reading and **cleared on
  sign-out**, so a shared device doesn't expose the previous user's material.
  Auth, exams and proctoring are never cached.
