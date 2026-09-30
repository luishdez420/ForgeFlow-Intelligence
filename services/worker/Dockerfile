# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /app

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
