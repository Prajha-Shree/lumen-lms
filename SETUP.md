# Lumen LMS: Complete Setup Guide

This guide covers everything needed to get the project running on a new computer:

1. [What you need](#1-what-you-need)
2. [Sharing the project with someone else](#2-sharing-the-project-with-someone-else)
3. [Run it with Docker (recommended)](#3-run-it-with-docker-recommended)
4. [First things to try](#4-first-things-to-try)
5. [Run the tests](#5-run-the-tests)
6. [Run it without Docker](#6-run-it-without-docker-alternative)
7. [Everyday commands](#7-everyday-commands)
8. [Troubleshooting](#8-troubleshooting)

> **Short version** (if Docker is already installed):
> ```bash
> docker compose up --build
> ```
> Wait for `lms-backend listening`, open **http://localhost:5173**, and click one of the
> demo accounts on the sign-in page.

---

## 1. What you need

### Option A: Docker (recommended, and the easiest)

Docker runs the whole system (database, backend, AI service, website) with one
command. **Nothing else needs to be installed**: no Node.js, no Python, no PostgreSQL.

| Requirement | Details |
|---|---|
| **Docker Desktop** | Windows 10/11 (64-bit), macOS, or Linux. Download from https://www.docker.com/products/docker-desktop/ . On Windows it uses **WSL 2**; the installer sets it up (virtualization must be enabled in BIOS, which it usually is). On Linux, Docker Engine + the Compose plugin also works. |
| **Memory** | 8 GB RAM on the computer (Docker needs about 4 GB of it). |
| **Disk space** | About **8 GB free** (the Docker images take about 4 GB). |
| **Internet** | Needed for the **first** build only (downloads base images and packages, about 2 GB). |
| **Free ports** | `5173` (website), `4000` (backend), `8000` (AI service), `5433` (database). You can change these; see [Troubleshooting](#8-troubleshooting). |
| **Browser** | Chrome, Edge or Firefox (current version). |
| **Webcam** | Optional; only needed to try the AI-proctored exam. |
| **Git** | Optional but recommended (for cloning and updates). https://git-scm.com/downloads |

### Option B: without Docker

| Requirement | Version |
|---|---|
| Node.js | 22 or newer (24 LTS recommended). https://nodejs.org |
| Python | 3.11 or newer (3.12 recommended; 3.14 also works). https://python.org |
| PostgreSQL | 16. https://www.postgresql.org/download/ |

Option B is more work; see [section 6](#6-run-it-without-docker-alternative).

---

## 2. Sharing the project with someone else

> **Don't just zip the project folder.** It is about 700 MB, mostly `node_modules/` and
> `.venv/` folders that only work on the computer that created them, and it may contain
> `.env` files with secrets. Use one of the methods below; they send only the source
> code (well under 1 MB).

**Before any method:** make sure all your changes are committed, because every method
sends the *committed* project:

```bash
git status          # should say "nothing to commit, working tree clean"
```

### Method 1: GitHub (best: easy updates, keeps history)

**Sender:**
1. Go to https://github.com/new and create a **Private** repository named `lumen-lms`.
   Don't add a README, .gitignore or license (the project already has them).
2. In the project folder, run (replace `YOUR-USERNAME`):
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/lumen-lms.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Collaborators → Add people**, then add the recipient's
   GitHub username.

**Recipient:**
```bash
git clone https://github.com/YOUR-USERNAME/lumen-lms.git
cd lumen-lms
```
To get later updates: `git pull`.

> Bonus: GitHub automatically runs the test suites on every push
> (`.github/workflows/ci.yml`).

### Method 2: a zip file (no GitHub account needed)

**Sender**, in the project folder:
```bash
git archive --format=zip --prefix=lumen-lms/ -o lumen-lms.zip HEAD
```
This creates `lumen-lms.zip` (about 0.4 MB) with exactly the committed source code,
and no secrets, dependencies or uploads. Send it by email, Google Drive, WeTransfer, USB, etc.

**Recipient:** extract the zip anywhere, e.g. `C:\Projects\lumen-lms` or `~/projects/lumen-lms`.

### Method 3: a Git bundle (offline, keeps full history)

**Sender:**
```bash
git bundle create lumen-lms.bundle --all
```
**Recipient:**
```bash
git clone lumen-lms.bundle lumen-lms
```

---

## 3. Run it with Docker (recommended)

### Step 1: Install and start Docker Desktop
1. Install Docker Desktop and restart the computer if asked.
2. **Open Docker Desktop** and wait until it says **"Engine running"** (bottom-left).
3. Check it works. Open a terminal (Windows: **PowerShell**; macOS/Linux: **Terminal**):
   ```bash
   docker --version
   docker compose version
   ```
   Both should print a version. If `docker info` prints *"failed to connect to the
   docker API"*, Docker Desktop isn't running yet.

### Step 2: Open a terminal in the project folder
```bash
cd path/to/lumen-lms
```
(Windows tip: in File Explorer, open the folder, type `powershell` in the address bar, press Enter.)

### Step 3 (optional): create a settings file
The project runs with safe defaults for local use, so you can skip this. To customize
ports or secrets:
```bash
# Windows PowerShell
Copy-Item .env.example .env
# macOS / Linux
cp .env.example .env
```

### Step 4: Build and start everything
```bash
docker compose up --build
```
- The **first run takes 5–15 minutes** (it downloads and builds everything).
  Later starts take seconds.
- It automatically creates the database, applies migrations and loads **demo data**.
- You'll see lots of log output. It's ready when you see:
  ```
  backend-1   | lms-backend listening on http://localhost:4000
  frontend-1  | VITE ... ready
  ```

### Step 5: Open the app
Go to **http://localhost:5173**.

On the sign-in page there's a **"Demo accounts"** panel. Click one to fill in the
details, then press **Sign in**.

| Role | Institution ID | Email |
|---|---|---|
| Student | `riverside` | student@riverside.test |
| Instructor | `riverside` | instructor@riverside.test |
| Institution admin | `riverside` | admin@riverside.test |
| Super admin | `platform` | superadmin@lumen.test |

All demo accounts share one password, the `DEMO_PASSWORD` constant in
`backend/prisma/seed.ts`. These are local test accounts only.

### Step 6: Stop it
- If it's running in the terminal: press **Ctrl + C**.
- Or, from another terminal: `docker compose down`

Your data is kept. Next time, just run `docker compose up` (no `--build` needed
unless dependencies changed).

### Other addresses (optional)
| URL | What |
|---|---|
| http://localhost:4000/api/health | Backend health: database + AI service status |
| http://localhost:8000/docs | AI service API documentation |

---

## 4. First things to try

1. **As the student:** *Learning profile*, then take the 16-question adaptive
   assessment and see your profile. Open *Foundations of Data Science* and look at
   "Up next for you" (hover **Why this?**). Complete a lesson and watch the XP and
   badge notification. Then *Exams → Checkpoint*: consent, camera check, take the
   exam, and see the results by topic.
2. **As the instructor:** the dashboard (live activity, heatmap, at-risk students),
   then **Proctoring reviews**: open a session to see the timeline and make a decision.
   In a course, the **Insights** tab and the **Assignments** tab (grade with the rubric).
3. **As the admin:** institution dashboard, then **People** (invite a user).
4. **As the super admin:** **Institutions** (tenant health, suspend or reactivate).
5. **Create a new school:** sign out, then *Create an institution*.

> **Tip:** for the live-update demo, open the instructor dashboard in one browser and
> the student in a **private/incognito window**. When the student completes a lesson,
> the instructor's charts update by themselves.

---

## 5. Run the tests

With the containers running (`docker compose up -d`), in a second terminal:

```bash
# Backend: 86 tests (tenant isolation, auth, exams, proctoring, analytics…)
docker compose exec -e TEST_DB_HOST=postgres:5432 backend npm test

# AI service: 38 tests (adaptive engine, recommender, proctoring geometry)
docker compose exec ml-service python -m pytest -q

# Frontend: 6 tests (API client / session refresh)
docker compose exec frontend npm test
```

---

## 6. Run it without Docker (alternative)

Use this if Docker can't be installed. You'll run three programs in three terminals.

### Step 1: Install the tools
Install Node.js 22+, Python 3.11+ and PostgreSQL 16 (see [section 1](#option-b-without-docker)).
During the PostgreSQL install, remember the password you set for the `postgres` user.

### Step 2: Create the database and its two users
The app deliberately uses two database users: an **owner** for setup/migrations, and a
restricted **app** user that the database itself limits to one institution's data
(row-level security).

Open **SQL Shell (psql)** (or run `psql -U postgres`), log in as `postgres`, and run:

```sql
CREATE ROLE lms_owner LOGIN PASSWORD 'lms_owner_dev_password' CREATEDB BYPASSRLS;
CREATE ROLE lms_app   LOGIN PASSWORD 'lms_app_dev_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE lms OWNER lms_owner;
```

### Step 3: Backend (terminal 1)
```bash
cd backend
# Windows: Copy-Item .env.example .env      macOS/Linux: cp .env.example .env
```
Open `backend/.env` and change **both** database URLs from port `5433` to **`5432`**
(the native PostgreSQL port):
```
DATABASE_URL=postgresql://lms_app:lms_app_dev_password@localhost:5432/lms
DIRECT_DATABASE_URL=postgresql://lms_owner:lms_owner_dev_password@localhost:5432/lms
```
Then:
```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```
Ready when it prints `lms-backend listening on http://localhost:4000`.

### Step 4: AI service (terminal 2)
```bash
cd ml-service
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt -r requirements-cv.txt
python -m app.proctoring.download_model     # face model for proctoring (~3.6 MB)
uvicorn app.main:app --reload
```
Ready when it prints `Uvicorn running on http://127.0.0.1:8000`.

### Step 5: Website (terminal 3)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** and sign in as in [section 3, step 5](#step-5-open-the-app).

### Running the tests without Docker
```bash
cd backend && npm test                     # add TEST_DB_HOST=localhost:5432 for native PostgreSQL
cd ml-service && python -m pytest -q
cd frontend && npm test
```
For a native PostgreSQL on 5432, set the variable first:
Windows `$env:TEST_DB_HOST="localhost:5432"`, macOS/Linux `export TEST_DB_HOST=localhost:5432`.

---

## 7. Everyday commands

| Task | Command |
|---|---|
| Start (first time / after dependency changes) | `docker compose up --build` |
| Start in the background | `docker compose up -d` |
| See what's running | `docker compose ps` |
| Follow backend logs | `docker compose logs -f backend` |
| Stop (keep data) | `docker compose down` |
| Reset demo data | `docker compose exec backend npm run db:seed -- --reset` |
| **Full reset** (deletes the database and uploads) | `docker compose down -v` then `docker compose up --build` |
| Rebuild one service | `docker compose up -d --build backend` |

Code changes in `frontend/src`, `backend/src` and `ml-service/app` reload
automatically while the containers run.

---

## 8. Troubleshooting

**"failed to connect to the docker API" / "Cannot connect to the Docker daemon"**
Docker Desktop isn't running. Start it and wait for "Engine running".

**"port is already allocated" / "address already in use"**
Another program is using that port. Create a `.env` file (step 3) and change the
port, e.g. `FRONTEND_PORT=5174`, `BACKEND_PORT=4001`, `ML_SERVICE_PORT=8001` or
`POSTGRES_PORT=5434`. Then run `docker compose up -d` and use the new website port.

**Backend exits with "Invalid environment configuration"**
A value in `.env` is wrong. The JWT secrets must be **at least 32 characters**.
Compare with `.env.example`.

**"password authentication failed for user lms_app" after editing `.env`**
The database users are created only the *first* time the database starts, so
changing passwords in `.env` later doesn't update them. Reset: `docker compose down -v`,
then `docker compose up --build` (this deletes local data).

**Sign-in says "Incorrect institution, email or password"**
Use the demo buttons on the sign-in page, or check the institution ID (`riverside`).
If the data was changed, reset it:
`docker compose exec backend npm run db:seed -- --reset`.

**Camera doesn't work in the proctored exam**
- Open the site as **http://localhost:5173**, not an IP address like
  `http://192.168.x.x:5173`. Browsers only allow the camera on `localhost` or HTTPS.
- Allow camera access when the browser asks (or via the camera icon in the address bar).
- Close other apps that use the camera (Zoom, Teams…).
- If http://localhost:4000/api/health doesn't list `faceLandmarker`, the face model
  wasn't downloaded (e.g. the network blocked it during the build). Exams still work
  with browser-only monitoring. To retry: `docker compose build --no-cache ml-service`,
  then `docker compose up -d`.

**The first build fails during `npm ci` or `pip install`**
Usually a network hiccup: run `docker compose up --build` again. On a company
network, a proxy may need to be configured in Docker Desktop
(Settings → Resources → Proxies).

**Everything is slow on Windows**
Give Docker more memory (Docker Desktop → Settings → Resources) and keep at least
4 GB assigned.

**Mac with Apple Silicon (M1/M2/M3)**
All images support ARM, so it should work as-is. It was tested on Windows x64. If a
build step fails, please report the error message.

---

## Keep in mind when sharing

- `.env` files are **not** shared on purpose (they may contain secrets). The
  recipient either skips them (defaults work locally) or copies `.env.example`.
- The demo passwords and default secrets are for **local use only**. Before putting
  this on a server, set strong `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `INTERNAL_SERVICE_TOKEN` and database passwords (see `README.md` → *Deploying*).
- More detail: `README.md` (overview) and `docs/architecture.md` (design + privacy).
