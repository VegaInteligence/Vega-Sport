# Vega worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f backend/Dockerfile -t vega-v2-worker:<sha> .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/backend/archives/builders VEGA_ARCHIVE_EDITION=/app/backend/archives/edition.mjs \
    VEGA_SOURCE_BRIDGE=/app/backend/sources/bridge.mjs VEGA_SHARED_DIR=/app/dashboard/shared
WORKDIR /app
# Node runs main's shared/archive.js for the archive import (vega/archives.py).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/vega vega
COPY backend/sql sql
# The archive import: its builders, the honours collector and the edition script, with the
# site's shared/archive.js.
COPY backend/archives backend/archives
COPY dashboard/shared/archive.js dashboard/shared/archive-text.js dashboard/shared/openfootball-history.js dashboard/shared/
# main's Wikidata and Commons readers (vega/sources/wikidata.py) and their imports.
COPY dashboard/frontend/src/services/wikidata-club.js dashboard/frontend/src/services/wikidata-club-identity.js \
     dashboard/frontend/src/services/wikidata-stadium.js dashboard/frontend/src/services/stadium-plans.js \
     dashboard/frontend/src/services/format.js dashboard/frontend/src/services/player-aliases.js dashboard/frontend/src/services/
COPY dashboard/frontend/src/data-url.js dashboard/frontend/src/model.js dashboard/frontend/src/
# data-url.js imports this module to map the site's reads to the API's routes.
COPY dashboard/frontend/src/services/api-routes.js dashboard/frontend/src/services/
COPY dashboard/shared/player-aliases.js dashboard/shared/league-rules.json dashboard/shared/cup-logos.json dashboard/shared/
# The cup source projections (vega/sources/cups.py) read these services of the site.
COPY dashboard/frontend/src/services/openfootball-france-cup.js dashboard/frontend/src/services/openfootball-cups.js \
     dashboard/frontend/src/services/cup-archives.js dashboard/frontend/src/services/openligadb.js \
     dashboard/frontend/src/services/competition-selector.js dashboard/frontend/src/services/nations-results.js dashboard/frontend/src/services/
COPY dashboard/shared/competition-scope.js dashboard/shared/
# The bridge, the coach portraits reader and the cup projections.
COPY backend/sources backend/sources
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega.worker"]
