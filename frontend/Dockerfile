FROM node:24-bookworm-slim AS deps
WORKDIR /srv/app
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: src/public/index.html are bind-mounted by docker-compose ----
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build: static bundle for any static host / CDN / nginx ----
FROM deps AS build
COPY . .
RUN npm run build
