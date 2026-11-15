# CivicQuill: the pinned Distributed Governance Engine release plus the civic
# extension. No credentials, certificates or customer data are baked in.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Endpoint-only MLS module for private workspaces, built from the engine's
# pinned OpenMLS sources with its checksum-verified toolchain.
FROM rust:1.94.0-slim-bookworm AS mls
WORKDIR /app
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/* \
  && rustup target add --toolchain 1.94.0 wasm32-unknown-unknown
COPY --from=deps /app/node_modules/@distributed-governance/engine/scripts ./scripts
RUN python3 scripts/install-mls-tools.py /opt/quill-mls-tools
ENV PATH=/opt/quill-mls-tools:$PATH
COPY --from=deps /app/node_modules/@distributed-governance/engine/crypto/mls-endpoint/Cargo.toml /app/node_modules/@distributed-governance/engine/crypto/mls-endpoint/Cargo.lock ./crypto/mls-endpoint/
COPY --from=deps /app/node_modules/@distributed-governance/engine/crypto/mls-endpoint/src ./crypto/mls-endpoint/src
RUN node scripts/build-mls.mjs

FROM deps AS build
COPY web ./web
COPY src ./src
COPY server ./server
COPY scripts/build.mjs ./scripts/build.mjs
RUN node scripts/build.mjs \
  && cd node_modules/@distributed-governance/engine && node scripts/build-private-workspace.mjs \
  && cp dist/private.js dist/private.js.map dist/private.html /app/dist/
COPY --from=mls /app/dist/mls ./dist/mls

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PRIVATE_WORKSPACES=enabled
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY server ./server
COPY migrations ./migrations
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 10000
CMD ["node","server/start.mjs"]
