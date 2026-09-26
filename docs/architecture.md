# Architecture & Decisions

This is a living record of the architectural decisions, why each was made, and the privacy
posture of the system. Update it when a decision changes.

## Services

```
 Browser ──(same-origin /api, /socket.io via Vite proxy)──▶ backend (Express, :4000)
                                                             │  Prisma (lms_app role, RLS)
                                                             ├──────────────▶ Postgres (:5432)
                                                             │  REST + X-Internal-Token
                                                             └──────────────▶ ml-service (FastAPI, :8000)
```

| Service      | Stack                                   | Owns                                              |
|--------------|-----------------------------------------|---------------------------------------------------|
| `frontend`   | React 19, Vite 7, Tailwind 4, Motion, Recharts, TanStack Query | UI, webcam capture, browser-side proctoring signals |
| `backend`    | Node 24, Express 5, Prisma 6, Zod 4     | Auth/RBAC, tenancy, LMS domain, analytics, orchestration |
| `ml-service` | Python 3.12, FastAPI, MediaPipe 1.x, scikit-learn | Stateless inference: cognitive profiling, recommendations, proctoring frame analysis |
| `postgres`   | PostgreSQL 16                           | All persistent state                              |

The ml-service is **stateless and has no database access**. The backend sends it what it
needs and persists the results, so the ML service can be swapped, scaled horizontally, or
moved to GPU hosts without touching the data layer.

## Decision log

### ADR-1: Row-level tenancy enforced by Postgres RLS
**Decision:** every tenant-owned table has a `tenant_id` column. Isolation is enforced twice:
1. **App layer:** a Prisma client extension scopes queries to the caller's tenant.
2. **Database layer:** Postgres Row-Level Security policies compare `tenant_id` against
   `current_setting('app.tenant_id')`, which the backend sets per transaction.

The backend connects as `lms_app`, a role with `NOBYPASSRLS` that is not the table owner,
so the policies always apply. Migrations run as the owner role `lms_owner` (Prisma
`directUrl`). A bug in a query can therefore not leak rows across tenants.

**Rejected:** schema-per-tenant. Stronger physical separation, but N-times migrations,
poor Prisma support, harder pooling, and cross-tenant Super Admin analytics become
cross-schema queries.

### ADR-2: Proctoring is server-side inference, events-only storage
**Decision:** during an exam the browser samples roughly one low-resolution frame every
2 seconds and sends it to the backend, which forwards it to the ml-service. The frame is
analyzed **in memory and discarded**. Only structured events are persisted:
`{ type, startedAt, endedAt, confidence }` (e.g. `NO_FACE`, `MULTIPLE_FACES`,
`LOOKING_AWAY`, `TAB_HIDDEN`). No images, no video.

**Rejected:** snapshot-on-flag (evidence, but stores biometric-adjacent images); client-side
inference (best privacy, but tamperable); full video (heavy compliance burden).

### ADR-3: No deep-learning framework in v1
**Decision:** MediaPipe 1.x (Tasks API, FaceLandmarker) handles face detection and landmarks;
its facial transformation matrix yields head pose directly. The recommender starts
rule-based with scikit-learn available. Both sit behind interfaces so a trained PyTorch
model can replace them later without API changes.

**Rejected for now:** PyTorch/TensorFlow up front. Much larger images, slower builds, and
no training data exists yet.

### ADR-4: Pinned, proven dependency lines
At project start npm's `latest` tags pointed at Prisma 8 (a release candidate) and
TypeScript 7 (the new native compiler). We pinned Prisma 6, TypeScript 5.9, Vite 7,
Vitest 4 and React Router 7 for stability. Revisit upgrades deliberately.

## Privacy & compliance notes

These are flagged for review by whoever deploys this for a real institution (FERPA in the
US, GDPR in the EU, and local equivalents).

**Webcam / proctoring**
- Explicit, informed consent screen before the camera turns on, stating what is analyzed,
  what is stored (events only), and retention. Declining must offer an alternative path
  that the institution configures, not a silent fail.
- Frames never touch disk or logs. Request bodies on the frame endpoint are excluded
  from logging.
- Flags are **signals for human review, not verdicts**. The instructor UI shows timelines
  of events, never an "integrity score" or accusation language.
- Retention: proctoring events are deleted after a per-tenant retention window.
- Known bias risk: face detection accuracy varies with skin tone, lighting, eyewear and
  disability. Thresholds must be conservative, and "no face detected" must never
  auto-fail a student.

**Cognitive profiling**
- Profiles are used only to personalize learning paths, never for grading or admission.
- Students can view their own profile, reset it, and retake the assessment.
- Profile labels are framed as preferences and current strengths, not fixed traits.
  Avoid the "learning styles" deficit framing.
- Profiles are tenant-scoped and visible to the student and their instructors only.
