# syntax=docker/dockerfile:1

FROM node:24.16.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

FROM base AS deps

# Native dependencies have prebuilt binaries on common platforms, but keeping
# the toolchain here also lets pnpm rebuild them on a new architecture.
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm prune --prod

FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Keep the full production dependency tree because the runtime MCP plugins
# resolve their own packages from the repository root.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=node:node /app/.next/standalone/.next ./.next
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The local MCP plugins load these TypeScript modules from the repository root
# at runtime, so they must be present beside the standalone server.
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/plugins ./plugins
COPY --from=builder --chown=node:node /app/package.json ./package.json

RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000
CMD ["node", "server.js"]
