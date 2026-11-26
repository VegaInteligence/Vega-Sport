# Vega worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f backend/Dockerfile -t vega-v2-worker:<identity> .
# Its tag is its identity (infra/aws/image_identity.py, FAILURE_MODES_OPTIMISATIONS.md GH158): the platform, this file,
# its .dockerignore and every file of the build context below. A Deploy builds an image only for an identity the
# registry does not hold.
#
# What the build resolves by itself is not in the identity: Debian's nodejs (apt-get) and pip's unpinned dependencies of
# boto3. An image keeps the versions it was built with until one of its inputs changes. To take newer ones (a security
# update) without a code change, change VEGA_DEPS_REFRESH below (a new identity, one rebuild, one restart of the worker
# and the backfill), or the base image's digest. apt's and pip's layers read it, so that a builder holding them in its
# cache runs them again (a comment is in no layer's cache key: GH158-g); a Deploy that leaves it reuses them.

# The build context as BuildKit sends it (this file's .dockerignore applied): what the image is made of. Built only when
# asked (--target context --output type=local), never part of the image.
FROM scratch AS context
COPY . /

# python:3.14-slim (3.14.10, Debian trixie) of 24 November 2026, by digest: a new base is a new identity.
FROM python:3.14-slim@sha256:22eafb370920ad8b429e0aec3fff433e0669968519f5d60469d83729c138b28b
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/backend/archives/builders VEGA_ARCHIVE_EDITION=/app/backend/archives/edition.mjs \
    VEGA_SOURCE_BRIDGE=/app/backend/sources/bridge.mjs VEGA_SHARED_DIR=/app/dashboard/shared
WORKDIR /app
ARG VEGA_DEPS_REFRESH=2026-11-26
# Node runs main's shared/archive.js for the archive import (vega/archives.py).
RUN echo "dependencies of $VEGA_DEPS_REFRESH" && apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN echo "dependencies of $VEGA_DEPS_REFRESH" && pip install --no-cache-dir -r requirements.txt
COPY backend/vega vega
COPY backend/sql sql
# The account's tables, applied by the migrate task apart from the football schemas, only once the
# account is on (vega/migrate.py ACCOUNT_SQL, backend/account/DEPLOYMENT.md section 4).
COPY backend/account/sql account/sql
# The archive import: its builders, the honours collector and the edition script, with the
# site's shared/archive.js.
COPY backend/archives backend/archives
COPY dashboard/shared/archive.js dashboard/shared/archive-text.js dashboard/shared/openfootball-history.js dashboard/shared/
# The published reading the corrected one is compared with (8018e0836c's files, FAILURE_MODES.md §22).
COPY dashboard/shared/legacy-8018e08 dashboard/shared/legacy-8018e08
# main's Wikidata and Commons readers (vega/sources/wikidata.py) and their imports.
COPY dashboard/frontend/src/services/wikidata-club.js dashboard/frontend/src/services/wikidata-club-identity.js \
     dashboard/frontend/src/services/wikidata-stadium.js dashboard/frontend/src/services/stadium-plans.js \
     dashboard/frontend/src/services/format.js dashboard/frontend/src/services/image-source.js dashboard/frontend/src/services/player-aliases.js \
     dashboard/frontend/src/services/
COPY dashboard/frontend/src/data-url.js dashboard/frontend/src/model.js dashboard/frontend/src/
# data-url.js imports this module to map the site's reads to the API's routes.
COPY dashboard/frontend/src/services/api-routes.js dashboard/frontend/src/services/
COPY dashboard/shared/player-aliases.js dashboard/shared/league-rules.json dashboard/shared/cup-logos.json dashboard/shared/
# The cup source projections (vega/sources/cups.py) read these services of the site.
COPY dashboard/frontend/src/services/openfootball-france-cup.js dashboard/frontend/src/services/openfootball-cups.js \
     dashboard/frontend/src/services/openfootball-euro.js \
     dashboard/frontend/src/services/cup-archives.js dashboard/frontend/src/services/openligadb.js \
     dashboard/frontend/src/services/competition-selector.js dashboard/frontend/src/services/nations-results.js dashboard/frontend/src/services/
COPY dashboard/shared/competition-scope.js dashboard/shared/
# The bridge, the coach portraits reader and the cup projections.
COPY backend/sources backend/sources
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega.worker"]
