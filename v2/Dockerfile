# Vega v2 worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f v2/Dockerfile -t vega-v2-worker:<sha> .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/dashboard/scripts VEGA_ARCHIVE_EDITION=/app/v2/archives/edition.mjs
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
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY dashboard/backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega_v2.worker"]
