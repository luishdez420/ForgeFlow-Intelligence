# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json

RUN npm ci

FROM dependencies AS build

WORKDIR /workspace

COPY tsconfig.base.json ./
COPY apps/web apps/web

ARG BUILD_REVISION=local
ARG NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace @forgeflow/web

FROM node:24-alpine AS runtime

WORKDIR /app

ARG BUILD_REVISION=local
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

LABEL org.opencontainers.image.title="forgeflow-web"
LABEL org.opencontainers.image.description="ForgeFlow analyst console"
LABEL org.opencontainers.image.revision=$BUILD_REVISION

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
