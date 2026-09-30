# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json

RUN npm ci

FROM dependencies AS runtime

ARG BUILD_REVISION=local

WORKDIR /workspace

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/schemas packages/schemas

ENV NODE_ENV=production
ENV PORT=3001

LABEL org.opencontainers.image.title="forgeflow-api"
LABEL org.opencontainers.image.description="ForgeFlow durable workflow API"
LABEL org.opencontainers.image.revision=$BUILD_REVISION

RUN npm run typecheck --workspace @forgeflow/api

USER node

EXPOSE 3001

CMD ["./node_modules/.bin/tsx", "apps/api/src/server.ts"]
