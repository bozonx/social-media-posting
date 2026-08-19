# syntax=docker/dockerfile:1
ARG NODE_MAJOR=24

FROM node:${NODE_MAJOR}-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/conformance/package.json packages/conformance/
COPY packages/platform-telegram/package.json packages/platform-telegram/
COPY apps/server/package.json apps/server/
COPY examples/embedded/package.json examples/embedded/
COPY examples/custom-platform/package.json examples/custom-platform/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
# `--legacy` keeps the workspace symlinked rather than injected: injecting would
# copy packages into node_modules during development too, breaking edit-and-rerun.
RUN pnpm --filter "./packages/*" --filter "./apps/server" build \
  && pnpm --filter "@bozonx/social-posting-server" deploy --prod --legacy /deploy

FROM node:${NODE_MAJOR}-bookworm-slim AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
  LISTEN_HOST=0.0.0.0 \
  LISTEN_PORT=8080 \
  LOG_LEVEL=warn \
  TZ=UTC \
  SERVICE_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/dist ./dist
COPY --from=build --chown=node:node /deploy/package.json ./package.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const b=(process.env.BASE_PATH||'').replace(/^\/+|\/+$/g,'');const p='/'+(b?b+'/':'')+'api/v1/health';fetch('http://127.0.0.1:'+(process.env.LISTEN_PORT||8080)+p).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/entry/node.js"]
