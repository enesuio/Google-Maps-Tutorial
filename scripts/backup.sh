#!/usr/bin/env sh
# Nightly pg_dump of the hydrox database from the compose "db" service.
# Usage: scripts/backup.sh /var/backups/hydrox45
set -eu
DEST="${1:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
cd "$(dirname "$0")/.."
mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/hydrox-$STAMP.sql.gz"
docker compose exec -T db pg_dump -U hydrox --clean --if-exists hydrox | gzip > "$OUT"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
# Photos live on disk, not in Postgres: archive the uploads volume too.
PHOTOS="$DEST/hydrox-uploads-$STAMP.tar.gz"
docker compose exec -T app tar -czf - -C /app uploads > "$PHOTOS"
echo "wrote $PHOTOS ($(du -h "$PHOTOS" | cut -f1))"
find "$DEST" \( -name 'hydrox-*.sql.gz' -o -name 'hydrox-uploads-*.tar.gz' \) -mtime "+$KEEP_DAYS" -delete
