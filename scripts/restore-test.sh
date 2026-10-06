#!/usr/bin/env sh
# Loads a dump into a scratch database, prints row counts, drops it.
# Usage: scripts/restore-test.sh backups/hydrox-20261007-031500.sql.gz
set -eu
DUMP="${1:?path to .sql.gz dump}"
cd "$(dirname "$0")/.."
docker compose exec -T db psql -U hydrox -d postgres -c "DROP DATABASE IF EXISTS hydrox_restore_test;" -c "CREATE DATABASE hydrox_restore_test;" >/dev/null
gunzip -c "$DUMP" | docker compose exec -T db psql -U hydrox -d hydrox_restore_test -q -v ON_ERROR_STOP=1 >/dev/null
docker compose exec -T db psql -U hydrox -d hydrox_restore_test -c \
  "SELECT 'users' AS t, count(*) FROM users UNION ALL SELECT 'goals', count(*) FROM goals UNION ALL SELECT 'checkins', count(*) FROM checkins;"
docker compose exec -T db psql -U hydrox -d postgres -c "DROP DATABASE hydrox_restore_test;" >/dev/null
echo "restore test OK"
