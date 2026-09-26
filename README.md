# Lumen LMS: Adaptive Multi-Tenant Learning Management

A multi-tenant LMS with an adaptive learning profile, an explainable recommendation
engine, privacy-first AI exam proctoring, and live analytics dashboards.

- **Multi-tenant by construction:** every institution's data is isolated by Postgres
  Row-Level Security, so even a buggy query can't cross tenants.
- **Adaptive learning:** a 16-item adaptive assessment (IRT-lite) builds a learner
  profile; a transparent recommender explains every suggestion.
- **AI proctoring without recordings:** webcam frames are analyzed in memory and
  discarded. Only short event notes are kept, and a human always makes the call.
- **Live dashboards:** student, instructor and admin views update over WebSockets.
- **Extras:** notifications, badges and streaks, a course forum, rubric grading,
  PWA (installable, offline lesson reading), dark mode, and accessibility throughout.

See [docs/architecture.md](docs/architecture.md) for the design decisions and the
privacy and compliance notes.

## Quick start (Docker)

Prerequisites: Docker Desktop running.

```bash
cp .env.example .env        # optional; every value has a dev default
docker compose up --build
```

On first start the backend applies migrations and seeds demo data automatically.

| URL | What |
|---|---|
| http://localhost:5173 | The app |
| http://localhost:4000/api/health | Backend readiness (DB + ML checks) |
| http://localhost:8000/docs | ml-service OpenAPI docs |
| localhost:5433 | Postgres (host port 5433 avoids clashing with a local Postgres) |

> **Face model:** building the ml-service image downloads MediaPipe's
> `face_landmarker.task` (~3.6 MB) from Google's official model storage. Without it
> the app still works: proctored exams fall back to browser-only signals, and
> `/api/health` reports `faceLandmarker: false`.

### Demo accounts

All demo accounts share the password `DEMO_PASSWORD` defined in
[backend/prisma/seed.ts](backend/prisma/seed.ts). In development the login page has
one-click buttons for these accounts.

| Role | Institution ID | Email |
|---|---|---|
| Student | `riverside` | student@riverside.test |
| Instructor | `riverside` | instructor@riverside.test |
| Institution admin | `riverside` | admin@riverside.test |
| Super admin | `platform` | superadmin@lumen.test |
| Admin, second tenant | `summit` | admin@summit.test |

Reset demo data at any time:

```bash
docker compose exec backend npm run db:seed -- --reset
```

### Walk the vertical slice

1. **Student** (`student@riverside.test`): Learning profile → take the 16-question
   adaptive assessment → see the profile → open *Foundations of Data Science* and see
   "Up next for you" with reasons → complete a lesson (XP, badge toast) → Exams →
   *Checkpoint* → consent → camera check → take the exam → results by topic.
2. **Instructor**: Dashboard (live activity, heatmap, at-risk students with reasons)
   → Proctoring reviews → open a session → timeline + decision → course *Insights*
   tab (lesson funnel, topic performance) → *Assignments* tab → grade with the rubric.
3. **Admin**: Dashboard (institution trend from nightly snapshots) → People (invite
   users; a one-time temporary password is shown) → System status.
4. **Super admin**: Institutions (tenant health; suspending ends all its sessions).
5. **New institution**: sign out → *Create an institution* (3-step onboarding).

## Running services on the host

Keep Postgres in Docker, and run the apps natively for faster iteration:

```bash
docker compose up -d postgres
```

**Backend** (Node 22+)
```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                 # http://localhost:4000
```

**ml-service** (Python 3.11+)
```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt -r requirements-cv.txt
python -m app.proctoring.download_model   # optional: enables camera analysis
uvicorn app.main:app --reload             # http://localhost:8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api and /socket.io to :4000)
```

## Tests

| Suite | Command | Covers |
|---|---|---|
| Backend (Vitest, real Postgres) | `cd backend && npm test` | Tenant isolation under RLS as the runtime role, auth + refresh-token rotation/reuse detection, RBAC, courses/progress, cognitive orchestration, recommendations (+ fallback), exams + proctoring pipeline, review policy, analytics, badges, forum, rubric grading |
| ml-service (pytest) | `cd ml-service && pytest` | Adaptive engine + Rasch scoring, sequence tamper-proofing, recommender ranking rules, head-pose/gaze geometry, frame decoding, proctoring API contract |
| Frontend (Vitest) | `cd frontend && npm test` | API client token refresh/retry/session-end logic |

Backend DB tests create and migrate a separate `lms_test` database on the compose
Postgres (`localhost:5433`). If Postgres isn't reachable they are reported as
skipped, not passed. CI runs all three suites ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Repository layout

```
frontend/     React 19 + Vite 7 + Tailwind 4 · components/ui, components/charts, features/*
backend/      Express 5 + Prisma 6 · modules/* (auth, courses, exams, proctoring, analytics…)
  prisma/     schema, migrations (incl. RLS policies), seed
ml-service/   FastAPI · cognitive/ (adaptive engine), recommender/, proctoring/
docker/       Postgres init (least-privilege app role)
docs/         Architecture decisions & privacy notes
```

## Configuration

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | Runtime connection as `lms_app` (RLS enforced) |
| `DIRECT_DATABASE_URL` | backend | Migration connection as the owner role |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | ≥32 chars; **change in production** |
| `INTERNAL_SERVICE_TOKEN` | backend + ml-service | Shared secret for service-to-service calls |
| `ML_SERVICE_URL` | backend | ml-service base URL |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | backend | Attachment storage (local driver) |
| `CORS_ORIGIN` | backend | Allowed browser origin(s) |
| `RECOMMENDER` | ml-service | Ranking strategy (`rule-based`; learned models plug in via the registry) |
| `FACE_MODEL_PATH` | ml-service | Path to `face_landmarker.task` |

## Deploying to AWS or Azure (not provisioned here)

| Piece | AWS | Azure |
|---|---|---|
| Frontend (`npm run build` → static) | S3 + CloudFront | Static Web Apps |
| Backend container | ECS Fargate / App Runner | Container Apps |
| ml-service container | ECS Fargate (scale on CPU) | Container Apps |
| Postgres 16 | RDS | Flexible Server |
| Attachments | S3 (implement `FileStorage`) | Blob Storage |
| Realtime + tracker state across replicas | ElastiCache Redis (Socket.IO adapter) | Azure Cache for Redis |
| Nightly jobs | One replica, or EventBridge → task | One replica, or Container Apps Jobs |

Production checklist: real secrets, `NODE_ENV=production`, HTTPS (secure cookies are
automatic), run `prisma migrate deploy` as the owner role and the app as `lms_app`,
and put the Socket.IO Redis adapter in place before running more than one backend replica.
