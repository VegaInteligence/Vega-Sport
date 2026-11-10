# Vega v2 worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f v2/Dockerfile -t vega-v2-worker:<sha> .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/v2/archives/builders VEGA_ARCHIVE_EDITION=/app/v2/archives/edition.mjs \
    VEGA_SOURCE_BRIDGE=/app/v2/sources/bridge.mjs VEGA_SHARED_DIR=/app/dashboard/shared
WORKDIR /app
# Node runs main's shared/archive.js for the archive import (vega_v2/archives.py).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
COPY v2/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY v2/vega_v2 vega_v2
COPY v2/sql sql
# The archive import: its builders, the honours collector and the edition script, with the
# site's shared/archive.js.
COPY v2/archives v2/archives
COPY dashboard/shared/archive.js dashboard/shared/archive-text.js dashboard/shared/openfootball-history.js dashboard/shared/
# main's Wikidata and Commons readers (vega_v2/sources/wikidata.py) and their imports.
COPY dashboard/frontend/src/services/wikidata-club.js dashboard/frontend/src/services/wikidata-club-identity.js \
     dashboard/frontend/src/services/wikidata-stadium.js dashboard/frontend/src/services/stadium-plans.js \
     dashboard/frontend/src/services/format.js dashboard/frontend/src/services/player-aliases.js dashboard/frontend/src/services/
COPY dashboard/frontend/src/data-url.js dashboard/frontend/src/model.js dashboard/frontend/src/
# data-url.js maps the site's reads to v2 routes when built for v2 (it imports this module).
COPY dashboard/frontend/src/services/v2-routes.js dashboard/frontend/src/services/
COPY dashboard/shared/player-aliases.js dashboard/shared/league-rules.json dashboard/shared/cup-logos.json dashboard/shared/
# The cup source projections (vega_v2/sources/cups.py) read these services of the site.
COPY dashboard/frontend/src/services/openfootball-france-cup.js dashboard/frontend/src/services/openfootball-cups.js \
     dashboard/frontend/src/services/cup-archives.js dashboard/frontend/src/services/openligadb.js \
     dashboard/frontend/src/services/competition-selector.js dashboard/frontend/src/services/nations-results.js dashboard/frontend/src/services/
COPY dashboard/shared/competition-scope.js dashboard/shared/
# The bridge, the coach portraits reader and the cup projections.
COPY v2/sources v2/sources
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY v2/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega_v2.worker"]
