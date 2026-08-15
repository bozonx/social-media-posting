# syntax=docker/dockerfile:1
ARG NODE_MAJOR=24

FROM node:${NODE_MAJOR}-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json tsconfig.lib.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:${NODE_MAJOR}-bookworm-slim AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
  LISTEN_HOST=0.0.0.0 \
  LISTEN_PORT=8080 \
  LOG_LEVEL=warn \
  TZ=UTC \
  SERVICE_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const b=(process.env.BASE_PATH||'').replace(/^\/+|\/+$/g,'');const p='/'+(b?b+'/':'')+'api/v1/health';require('http').get('http://127.0.0.1:'+(process.env.LISTEN_PORT||8080)+p,r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/src/main.js"]
