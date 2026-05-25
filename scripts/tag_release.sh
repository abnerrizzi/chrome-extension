#!/usr/bin/env bash
# Cria uma tag Liquibase no banco containerizado.
# Uso: ./scripts/tag_release.sh v3
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "uso: $0 <tag>" >&2
  exit 1
fi
docker compose run --rm liquibase tag "$1"
echo "OK — tag $1 aplicada. Reverter com: docker compose run --rm liquibase rollback $1"
