# Vega worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f backend/Dockerfile -t vega-v2-worker:<identity> .
# Its tag is its identity (infra/aws/image_identity.py, FAILURE_MODES_OPTIMISATIONS.md GH158): the platform, this file,
# its .dockerignore and every file of the build context below. A Deploy builds an image only for an identity the
# registry does not hold.
#
# Debian's libstdc++ and pip's unpinned dependencies resolve at build time. Change VEGA_DEPS_REFRESH to refresh
# both layers (GH158-g). Python and Node follow their base image digests.

# The build context as BuildKit sends it (this file's .dockerignore applied): what the image is made of. Built only when
# asked (--target context --output type=local), never part of the image.
FROM scratch AS context
COPY . /

# The receipt preparer shares the Lambda's Node major and its locked PostgreSQL parser (GH137R).
FROM node:24-trixie-slim@sha256:4d00acb4bcc42c454c4eb801526f7ad7f772ea3bd4fd168c5cc2e384abcbb9d4 AS read-runtime
WORKDIR /app/backend/api
COPY backend/api/package.json backend/api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# python:3.14-slim (3.14.10, Debian trixie) of 24 November 2026, by digest: a new base is a new identity.
FROM python:3.14-slim@sha256:22eafb370920ad8b429e0aec3fff433e0669968519f5d60469d83729c138b28b
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VEGA_ARCHIVE_SCRIPTS=/app/backend/archives/builders VEGA_ARCHIVE_EDITION=/app/backend/archives/edition.mjs \
    VEGA_SOURCE_BRIDGE=/app/backend/sources/bridge.mjs VEGA_SHARED_DIR=/app/dashboard/shared
WORKDIR /app
ARG VEGA_DEPS_REFRESH=2026-11-26
# Node runs the read receipt, archive and source scripts.
COPY --from=read-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=read-runtime /app/backend/api/node_modules backend/api/node_modules
RUN echo "dependencies of $VEGA_DEPS_REFRESH" && apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN echo "dependencies of $VEGA_DEPS_REFRESH" && pip install --no-cache-dir -r requirements.txt
COPY backend/vega vega
COPY backend/sql sql
# The account's tables, applied by the migrate task apart from the football schemas, only once the
# account is on (vega/migrate.py ACCOUNT_SQL, backend/account/DEPLOYMENT.md section 4).
COPY backend/account/sql account/sql
# The archival and read-API modules share these sources. Keep the same layout as in the Lambda's source tree.
COPY backend/archives backend/archives
COPY backend/api/src backend/api/src
COPY backend/api/package.json backend/api/package-lock.json backend/api/
COPY dashboard/shared dashboard/shared
# The parser manifest includes the preserved 8018e0836c source baseline (FAILURE_MODES.md §22).
COPY dashboard/shared/legacy-8018e08 dashboard/shared/legacy-8018e08
# main's Wikidata and Commons readers (vega/sources/wikidata.py) and their imports.
COPY dashboard/frontend/src/services/wikidata-club.js dashboard/frontend/src/services/wikidata-club-identity.js \
     dashboard/frontend/src/services/wikidata-stadium.js dashboard/frontend/src/services/stadium-plans.js \
     dashboard/frontend/src/services/format.js dashboard/frontend/src/services/image-source.js dashboard/frontend/src/services/player-aliases.js \
     dashboard/frontend/src/services/
COPY dashboard/frontend/src/data-url.js dashboard/frontend/src/model.js dashboard/frontend/src/
# data-url.js imports this module to map the site's reads to the API's routes.
COPY dashboard/frontend/src/services/api-routes.js dashboard/frontend/src/services/
# The cup source projections (vega/sources/cups.py) read these services of the site.
COPY dashboard/frontend/src/services/openfootball-france-cup.js dashboard/frontend/src/services/openfootball-cups.js \
     dashboard/frontend/src/services/openfootball-euro.js \
     dashboard/frontend/src/services/cup-archives.js dashboard/frontend/src/services/openligadb.js \
     dashboard/frontend/src/services/competition-selector.js dashboard/frontend/src/services/nations-results.js dashboard/frontend/src/services/
# The bridge, the coach portraits reader and the cup projections.
COPY backend/sources backend/sources
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega.worker"]
