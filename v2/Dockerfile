# Vega v2 worker image. Build from the repository root:
#   docker build --platform linux/arm64 -f v2/Dockerfile -t vega-v2-worker:<sha> .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY v2/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY v2/vega_v2 vega_v2
COPY v2/sql sql
# Database URLs use sslmode=verify-full&sslrootcert=/app/rds-ca.pem
COPY dashboard/backend/certs/rds-us-east-2.pem rds-ca.pem
USER 10001
ENTRYPOINT ["python", "-m", "vega_v2.worker"]
