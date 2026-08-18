# ─── AgnoHire API — production image ─────────────────────────────────────────
# Multi-stage build over the npm workspaces monorepo (shared + server).
# bcrypt / @napi-rs/canvas are native modules — building inside this
# Debian-based image guarantees the compiled binaries match the runtime OS.
# Do NOT copy a node_modules built on a different host/OS into this image.
#
# Build from the REPO ROOT (not server/), e.g.:
#   docker build -f server/Dockerfile -t agnohire-server .

FROM node:20-bookworm-slim AS deps
# Prisma's query engine needs libssl to be present and detectable, or it
# silently guesses a version and can fail to load at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

FROM deps AS build
COPY shared shared
COPY server server
RUN npm run build --workspace shared \
 && npm run tools:generate --workspace server \
 && npm run build --workspace server

FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
# npm workspaces nests some deps (e.g. prisma, @prisma/client) inside the
# workspace's own node_modules instead of hoisting to the root — without this,
# `npx prisma` finds nothing locally and silently downloads the latest prisma
# from the registry at runtime, ignoring the pinned schema-compatible version.
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
COPY server/prisma server/prisma
COPY server/tsconfig.json server/tsconfig.json
# prisma/seed.ts is run directly via tsx (not compiled) and imports TS source
# (e.g. ../src/config/encryption.js -> src/config/encryption.ts), so the raw
# src tree must be present here even though the app itself runs from dist/.
COPY server/src server/src

WORKDIR /app/server
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/app.js"]
