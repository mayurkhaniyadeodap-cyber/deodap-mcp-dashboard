# DeoDap MCP Dashboard — single-container image (built frontend served by FastAPI).
# Build context = repo root.

# ---- Stage 1: build the Vite frontend ----
FROM node:20-slim AS frontend
WORKDIR /fe
RUN corepack enable
# Copy manifests first for layer caching.
COPY Web/frontend/package.json Web/frontend/pnpm-lock.yaml Web/frontend/pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY Web/frontend/ ./
RUN corepack pnpm build          # → /fe/dist

# ---- Stage 2: python runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# Backend deps first (cached until requirements change).
COPY Web/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend source + built frontend (main.py serves ./static when index.html exists).
COPY Web/backend/app ./app
COPY --from=frontend /fe/dist ./static

# Non-root runtime user; /data holds the SQLite DB (mount a volume there).
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000
# 1 worker on purpose: the live_or_mock cache is in-memory per process, so N
# workers = N caches = N× MCP load. Scale vertically first; revisit with a shared
# cache (out of scope now) before adding workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
