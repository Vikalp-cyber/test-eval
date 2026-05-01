#!/usr/bin/env bash
# From repo root: bash scripts/dev.sh
# Starts Docker Postgres + API (Bun/Hono) + Next.js via Turborepo.

set -euo pipefail
cd "$(dirname "$0")/.."

export PORT="${PORT:-3000}"
export WEB_PORT="${WEB_PORT:-3101}"
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:${WEB_PORT}}"
export NEXT_PUBLIC_SERVER_URL="${NEXT_PUBLIC_SERVER_URL:-http://localhost:${PORT}}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:${PORT}}"
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-55432}"
export DB_NAME="${DB_NAME:-healosbench}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"
export DATABASE_URL="${DATABASE_URL:-postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop and ensure docker is on PATH."
  exit 1
fi

mkdir -p apps/server
touch apps/server/.env

upsert_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" apps/server/.env 2>/dev/null; then
    sed -i.bak "s|^${key}=.*$|${key}=${val}|g" apps/server/.env && rm -f apps/server/.env.bak
  else
    printf '%s=%s\n' "${key}" "${val}" >> apps/server/.env
  fi
}

upsert_env "DATABASE_URL" "${DATABASE_URL}"
upsert_env "CORS_ORIGIN" "${CORS_ORIGIN}"
upsert_env "BETTER_AUTH_URL" "${BETTER_AUTH_URL}"

echo "Ensuring Postgres container is running..."
docker compose up -d postgres

for _ in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' test-evals-postgres 2>/dev/null || true)"
  if [[ "${status}" == "healthy" ]]; then
    break
  fi
  sleep 0.5
done

echo ""
echo "Using:"
echo "  PORT (API)               = ${PORT}"
echo "  WEB_PORT (Next)          = ${WEB_PORT}"
echo "  CORS_ORIGIN              = ${CORS_ORIGIN}"
echo "  NEXT_PUBLIC_SERVER_URL   = ${NEXT_PUBLIC_SERVER_URL}"
echo "  BETTER_AUTH_URL          = ${BETTER_AUTH_URL}"
echo "  DATABASE_URL             = ${DATABASE_URL}"
echo ""
echo "Database is Docker-managed via docker-compose (service: postgres)."
echo "Keep in apps/server/.env: BETTER_AUTH_SECRET (32+ chars), BETTER_AUTH_URL, CORS_ORIGIN, ANTHROPIC_API_KEY"
echo "  Tip: CORS_ORIGIN must match Next (default http://localhost:${WEB_PORT}); BETTER_AUTH_URL = API URL"
echo ""

bun run dev
