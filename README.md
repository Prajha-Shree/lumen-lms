# Lumen LMS: Adaptive Multi-Tenant Learning Management

A multi-tenant LMS with AI-driven cognitive profiling, adaptive recommendations, and
privacy-conscious AI exam proctoring.

> **Status:** Phase 1 (scaffolding) complete. See [Roadmap](#roadmap).

## Repository layout

```
frontend/     React 19 + Vite + Tailwind 4 (design tokens, dark mode, components/ui)
backend/      Node + Express 5 + Prisma 6 (auth, tenancy, LMS core, analytics)
ml-service/   Python FastAPI (cognitive profiling, recommendations, proctoring CV)
docker/       Postgres init scripts (least-privilege app role for RLS)
docs/         Architecture decisions & privacy notes
```

Read [docs/architecture.md](docs/architecture.md) for the why behind the design.

## Quick start (Docker, recommended)

Prerequisites: Docker Desktop running.

```bash
cp .env.example .env        # optional; every value has a dev default
docker compose up --build
```

| URL                             | What                                   |
|---------------------------------|----------------------------------------|
| http://localhost:5173           | Frontend (system status page for now)  |
| http://localhost:4000/api/health| Backend readiness (DB + ML checks)     |
| http://localhost:8000/docs      | ml-service OpenAPI docs                |
| localhost:5432                  | Postgres (`lms_owner` / `lms_app`)     |

Source folders are bind-mounted, so edits hot-reload in all three app containers.

To wipe the database (and re-run the role init script):

```bash
docker compose down -v
```

## Running services on the host (without Docker for the apps)

Useful for faster iteration and debuggers. Keep Postgres in Docker:

```bash
docker compose up -d postgres
```

**Backend**
```bash
cd backend
cp .env.example .env
npm install
npm run dev          # http://localhost:4000
npm test             # vitest
```

**ml-service**
```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate           # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt -r requirements-cv.txt
uvicorn app.main:app --reload    # http://localhost:8000
pytest
```

**Frontend**
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :4000
```

## Roadmap

| # | Phase                                   | Status |
|---|-----------------------------------------|--------|
| 1 | Scaffolding, Docker Compose, health checks, design tokens | ✅ |
| 2 | Schema, multi-tenancy (RLS), migrations  | ⏳ |
| 3 | Auth (JWT + refresh), RBAC, institution onboarding | |
| 4 | Core LMS: courses, modules, lessons, enrollment | |
| 5 | Cognitive profile assessment             | |
| 6 | Adaptive recommendation engine           | |
| 7 | AI proctoring                            | |
| 8 | Analytics dashboards                     | |
| 9 | UI polish, plus extras: notifications, gamification, forum, rubrics, PWA | |
| 10| Test coverage & final run instructions   | |
