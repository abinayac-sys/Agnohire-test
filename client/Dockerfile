# ─── AgnoHire web edge — static SPA + nginx ───────────────────────────────────
# Builds the Vite SPA and serves it from nginx, which also proxies /api and
# /socket.io to the "server" container (see client/nginx.conf).
#
# Build from the REPO ROOT (not client/), e.g.:
#   docker build -f client/Dockerfile -t agnohire-web .

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY shared shared
COPY client client
RUN npm run build --workspace shared \
 && npm run build --workspace client

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
