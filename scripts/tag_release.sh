#!/usr/bin/env bash
# Cria uma tag Liquibase no banco containerizado.
# Uso: ./scripts/tag_release.sh [--backend postgres|sqlite] <tag>
set -euo pipefail

BACKEND="postgres"
if [[ "${1:-}" == "--backend" ]]; then
  BACKEND="${2:-}"
  shift 2
fi

if [[ $# -ne 1 || -z "${BACKEND}" ]]; then
  echo "uso: $0 [--backend postgres|sqlite] <tag>" >&2
  exit 1
fi

TAG="$1"
case "${BACKEND}" in
  postgres) SERVICE="liquibase" ;;
  sqlite)   SERVICE="liquibase-sqlite" ;;
  *) echo "backend inválido: ${BACKEND}" >&2; exit 1 ;;
esac

docker compose --profile "${BACKEND}" run --rm "${SERVICE}" tag "${TAG}"
echo "OK — tag ${TAG} aplicada (${BACKEND}). Reverter com:"
echo "  docker compose --profile ${BACKEND} run --rm ${SERVICE} rollback ${TAG}"
