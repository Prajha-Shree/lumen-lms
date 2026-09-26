# ---- base: runtime deps Prisma needs ----
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/app

# ---- deps: install from lockfile, generate Prisma client ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# ---- dev: source is bind-mounted by docker-compose ----
FROM deps AS dev
COPY . .
EXPOSE 4000
# Regenerate the client (picks up host schema edits), apply migrations, seed demo
# data if absent (idempotent), then start the watcher.
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && npm run db:seed && npm run dev"]

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- prod ----
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /srv/app/node_modules ./node_modules
COPY --from=build /srv/app/dist ./dist
COPY --from=build /srv/app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
