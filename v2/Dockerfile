# Vega v2 worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f v2/Dockerfile -t vega-v2-worker:<sha> .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/dashboard/scripts VEGA_ARCHIVE_EDITION=/app/v2/archives/edition.mjs \
    VEGA_SOURCE_BRIDGE=/app/v2/sources/bridge.mjs
WORKDIR /app
# Node runs main's shared/archive.js for the archive import (vega_v2/archives.py).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
COPY v2/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY v2/vega_v2 vega_v2
COPY v2/sql sql
# The archive import runs main's builders and shared/archive.js unchanged.
COPY dashboard/scripts/build_openfootball_history.py dashboard/scripts/build_footballcsv_history.py \
     dashboard/scripts/build_engsoccerdata_history.py dashboard/scripts/build_scottish_history.py \
     dashboard/scripts/build_historical_goals.py dashboard/scripts/
COPY dashboard/shared/archive.js dashboard/shared/archive-text.js dashboard/shared/openfootball-history.js dashboard/shared/
COPY v2/archives/edition.mjs v2/archives/
# main's Wikidata and Commons readers (vega_v2/sources/wikidata.py) and their imports.
COPY dashboard/frontend/src/services/wikidata-club.js dashboard/frontend/src/services/wikidata-club-identity.js \
     dashboard/frontend/src/services/wikidata-stadium.js dashboard/frontend/src/services/stadium-plans.js \
     dashboard/frontend/src/services/format.js dashboard/frontend/src/services/player-aliases.js dashboard/frontend/src/services/
COPY dashboard/frontend/src/data-url.js dashboard/frontend/src/model.js dashboard/frontend/src/
COPY dashboard/scripts/coach-portrait-source.mjs dashboard/scripts/
COPY dashboard/shared/player-aliases.js dashboard/shared/
# main's cup source projections (vega_v2/sources/cups.py) and their imports.
COPY dashboard/scripts/source-projections/open-cups.mjs dashboard/scripts/source-projections/openligadb.mjs \
     dashboard/scripts/source-projections/nations-results.mjs dashboard/scripts/source-projections/
COPY dashboard/frontend/src/services/openfootball-france-cup.js dashboard/frontend/src/services/openfootball-cups.js \
     dashboard/frontend/src/services/cup-archives.js dashboard/frontend/src/services/openligadb.js \
     dashboard/frontend/src/services/competition-selector.js dashboard/frontend/src/services/nations-results.js dashboard/frontend/src/services/
COPY dashboard/shared/competition-scope.js dashboard/shared/
COPY v2/sources/bridge.mjs v2/sources/
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY dashboard/backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega_v2.worker"]
