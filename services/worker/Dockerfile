# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /app

# Keep the worker's PostgreSQL client on the same verified AWS RDS trust chain
# as the API. The global bundle is supplied by AWS over TLS at image build.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates curl \
  && curl --fail --location --silent --show-error \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    --output /usr/local/share/ca-certificates/aws-rds-global-bundle.crt \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY services/worker/pyproject.toml ./
COPY services/worker/forgeflow_worker ./forgeflow_worker

RUN pip install --no-cache-dir . \
  && useradd --create-home --uid 10001 forgeflow

ARG BUILD_REVISION=local
LABEL org.opencontainers.image.title="forgeflow-worker"
LABEL org.opencontainers.image.description="ForgeFlow durable workflow worker"
LABEL org.opencontainers.image.revision=$BUILD_REVISION

ENV PYTHONUNBUFFERED=1

USER forgeflow

ENTRYPOINT ["python", "-m", "forgeflow_worker"]
CMD []
