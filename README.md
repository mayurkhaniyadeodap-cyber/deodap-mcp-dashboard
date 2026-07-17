# DeoDap MCP Dashboard

A courier-billing & logistics analytics dashboard for DeoDap. It surfaces live
shipping cost, COD reconciliation, weight-dispute, RTO/NDR, and rate-difference
data pulled from the **Ship MCP** server, with a transparent mock fallback wherever
no live source exists yet.

<p align="center">
  <em>React + Vite + TypeScript frontend · FastAPI backend · single-container Docker deploy</em>
</p>

---

## Overview

The whole app follows **one architectural rule**: the frontend never touches data
directly. Every value flows through a single path, and there is exactly one I/O
boundary in each tier.

```
React page → TanStack Query hook (src/services/*) → Axios → /api/... →
FastAPI router → service layer → Ship MCP tool (live)  ─or─  mock JSON (fallback)
```

TypeScript types are **generated** from FastAPI's OpenAPI schema — never
hand-written. Every card shows a 🟢 **Live** / ⚪ **Sample** badge driven by the
per-response `source` field, so the UI never lies about where a number came from.

> A full field-level provenance map (every UI value → MCP tool → response field)
> lives in [`MCP_DATA_MAPPING.md`](./MCP_DATA_MAPPING.md).

## Features

- **10 analytics pages** — Dashboard, Bills, Courier Comparison, Discrepancies,
  COD Reconciliation, State Analysis, Weight Analysis, Trend Analysis, Export,
  Configuration.
- **Live MCP integration** with a 60s cache and automatic mock fallback (blank
  token / MCP error → committed sample data, never a broken screen).
- **Honest provenance & maturity** — Live/Sample badges and per-panel date-basis
  labels (`Order date · Last 30 days`, `Reconciliation date · …`).
- **JWT auth with server-side RBAC** — Admin / Employee roles enforced in the API
  (`require_role`), not just the UI. Users live in the database (bcrypt-hashed).
- **CSV / XLSX export** of live datasets, role-gated.
- **MCP Status page** — a live-vs-mock snapshot across every endpoint.
- **Single-container deploy** — the built frontend is served by FastAPI.

## Tech stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, TanStack Query, Axios, Zustand, React Router, React Hook Form, Zod, Recharts, Tailwind CSS, lucide-react |
| **Backend** | FastAPI, Pydantic v2, pydantic-settings, python-jose (JWT), passlib + bcrypt, SQLAlchemy 2.0, Alembic, openpyxl, httpx, official `mcp` SDK |
| **Data** | Ship MCP server (live) · SQLite (users) · committed JSON fixtures (fallback) |
| **Tooling** | pnpm, openapi-typescript, Ruff, Black, ESLint, Prettier |
| **Deploy** | Docker (multi-stage node + python:3.12-slim), Docker Compose, uvicorn |

## Prerequisites

- **Node 20+** and **pnpm** (`corepack enable`)
- **Python 3.12**
- **Docker** (optional, for the containerised deploy)

## Installation & local development

### 1. Backend (FastAPI)

```bash
cd Web/backend
python -m venv venv
# Windows:        venv\Scripts\Activate.ps1
# macOS / Linux:  source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the values (see below)
uvicorn app.main:app --reload   # http://localhost:8000 · docs at /docs
```

Health check: <http://localhost:8000/api/health>

On first boot the users table is empty, so **one admin is seeded** from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. If `ADMIN_PASSWORD` is blank, a random password
is generated and printed to the log **once** — use it to log in, then change it.

### 2. Frontend (Vite)

```bash
cd Web/frontend
pnpm install
cp .env.example .env            # VITE_API_BASE_URL=/api (relative, same-origin)
pnpm dev                        # http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:8000`, so no backend host
is hard-coded.

### 3. Generate frontend types from the API

```bash
cd Web/frontend
pnpm gen:types   # writes src/types/api.gen.ts from http://localhost:8000/openapi.json
```

Import shapes from `src/types/api.ts` (friendly aliases); never hand-edit `api.gen.ts`.

## Docker setup

The image builds the frontend and serves the static bundle from FastAPI — one
container, one port.

```bash
# 1. Create the production env file from the template and fill it in
cp Web/backend/.env.example Web/backend/.env.production
#    → set ENVIRONMENT=production, a fresh JWT_SECRET, ADMIN_PASSWORD, MCP_TOKEN

# 2. Build & run
docker compose build
docker compose up -d            # serves on 127.0.0.1:8000 (internal only)

# 3. Health
curl http://localhost:8000/api/health
```

Production boot is **fail-fast**: it refuses to start with the dev JWT secret or
with `ENABLE_MCP_DEBUG=true`, and it disables `/docs` + `/openapi.json`. The
container binds to loopback — put it behind your VPN / reverse proxy (HTTPS
terminated there). SQLite persists on the `dashboard-data` volume.

## Environment variables

Backend (`Web/backend/.env` — see `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `ENVIRONMENT` | prod | `development` \| `production`. Production enables the boot guards. |
| `JWT_SECRET` | **prod** | JWT signing secret. Generate: `python -c "import secrets;print(secrets.token_urlsafe(48))"`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | Token lifetime (default 480 = 8h). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first boot | Seeds the first admin when the DB is empty. |
| `DATABASE_URL` | no | User store. Default SQLite; container uses `sqlite:////data/deodap.db`. |
| `CORS_ORIGINS` | no | Comma-separated allowed origins. Never `*`. |
| `MCP_URL` / `MCP_TOKEN` | live data | Ship MCP base URL + token (URL query auth). Blank → mock fallback. |
| `MCP_TIMEOUT_SECONDS` | no | Per-call timeout (default 30). |
| `ENABLE_MCP_DEBUG` | no | Mounts `/_mcp/probe` + `/_mcp/tools`. **Must be false in production.** |

Frontend (`Web/frontend/.env`): `VITE_API_BASE_URL=/api` (relative → same-origin).

## Folder structure

```
.
├─ Dockerfile                  # multi-stage: build frontend → python runtime
├─ docker-compose.yml          # single-container deploy (env_file, volume, healthcheck)
├─ README.md · MCP_DATA_MAPPING.md
├─ Res/guide                   # architecture guide
└─ Web/
   ├─ backend/                 # FastAPI app
   │  ├─ app/
   │  │  ├─ main.py            # app, middleware, startup seed, static SPA serving
   │  │  ├─ core/              # config (pydantic-settings), security (JWT + bcrypt)
   │  │  ├─ api/routers/       # auth, dashboard, analytics, bills, export, users, status, meta
   │  │  ├─ services/          # ⭐ the ONLY data source — MCP client + per-domain services
   │  │  ├─ schemas/           # Pydantic response contracts
   │  │  ├─ models/            # SQLAlchemy 2.0 (User store is live)
   │  │  ├─ database/          # engine/session + mock JSON fixtures
   │  │  └─ auth/              # role definitions
   │  ├─ alembic/              # migration scaffold
   │  └─ requirements.txt
   └─ frontend/                # Vite + React app
      ├─ src/
      │  ├─ pages/  components/  layouts/
      │  ├─ services/          # TanStack Query hooks (the only Axios callers)
      │  ├─ store/  hooks/  routes/  utils/  types/
      │  └─ config/
      ├─ vite.config.ts        # /api → :8000 proxy
      └─ package.json
```

## API documentation

All routes are under `/api`, JSON unless noted. Everything except `/login` and
`/health` requires a `Bearer` token; `/export/{fmt}` and `/users` require specific
roles. Interactive docs at `/docs` (development only).

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/login` | public | email + password → JWT + user |
| `GET` | `/me` | user | current user |
| `GET` | `/health` | public | liveness probe |
| `GET` | `/dashboard` · `/dashboard/rate-diff` · `/dashboard/courier-billing` | user | KPIs, charts, sampled billing |
| `GET` | `/couriers` · `/cod` · `/zones` · `/weight` · `/trend` · `/discrepancies` | user | analytics resources |
| `GET` | `/bills` | user | `?search=&status=&sort=&page=&page_size=` |
| `GET` | `/savings-opportunity` · `/trend-recovery` | user | slow, separately cached |
| `GET` | `/settings` | user | read-only config |
| `GET`/`POST`/`PATCH`/`DELETE` | `/users` | **admin** | user management |
| `GET` | `/export` · `/export/{fmt}` | user / **non-viewer** | dataset catalog · CSV\|XLSX |
| `GET` | `/_status` | user | live-vs-mock snapshot |
| `GET` | `/_meta/sources` | public | provenance map for badges |

## Deployment

1. `cp Web/backend/.env.example Web/backend/.env.production` and fill it in
   (`ENVIRONMENT=production`, fresh `JWT_SECRET`, strong `ADMIN_PASSWORD`, `MCP_TOKEN`,
   `DATABASE_URL=sqlite:////data/deodap.db`).
2. `docker compose build && docker compose up -d`.
3. Front it with your internal reverse proxy / VPN (HTTPS at the proxy). The
   container listens on `127.0.0.1:8000` and is not publicly reachable by default.
4. Run **1 worker** (the live cache is in-memory per process); scale vertically.

## Contributing conventions

- **Data boundary:** components call hooks in `src/services/`; hooks call Axios;
  Axios hits `/api/...`. No JSON is imported into the frontend.
- **Types from the API:** run `pnpm gen:types` — never hand-write response types.
- **Config:** backend reads env only via `app/core/config.py`; frontend only via
  `import.meta.env.VITE_*`.

## License

See [LICENSE](./LICENSE). (Recommended: MIT for open source, or "UNLICENSED /
proprietary" if this stays internal to DeoDap.)
