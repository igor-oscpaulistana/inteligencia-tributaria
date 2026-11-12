#!/usr/bin/env bash
# Testa as migrações em um PostgreSQL local descartável.
# Requer psql com permissão para criar bancos (PGHOST, PGUSER etc. conforme o ambiente).
set -euo pipefail

BANCO="${BANCO_TESTE:-inteligencia_tributaria_teste}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${BANCO}" -c "create database ${BANCO}"
psql -v ON_ERROR_STOP=1 -q -d "${BANCO}" -f "${DIR}/testes/stub_supabase.sql"
for migracao in "${DIR}"/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "${BANCO}" -f "${migracao}"
done
psql -v ON_ERROR_STOP=1 -q -At -d "${BANCO}" -f "${DIR}/testes/etapa1.sql" | grep -v "^$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database ${BANCO}"
