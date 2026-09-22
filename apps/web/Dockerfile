# Builds the SPA; Caddy serves the static output.
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @app/shared build && pnpm --filter web build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/apps/web/dist /srv
