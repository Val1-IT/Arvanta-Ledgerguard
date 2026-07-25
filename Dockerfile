# Minimal production image for the LedgerGuard Next.js app.
# Builds on next.config.mjs's `output: 'standalone'` — this image contains
# only the app itself. Postgres and DataHub are separate services (see
# docker-compose.demo.yml and docs/deployment.md); this image does not bundle
# or start either.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S ledgerguard && adduser -S ledgerguard -G ledgerguard
COPY --from=build /app/public ./public
COPY --from=build --chown=ledgerguard:ledgerguard /app/.next/standalone ./
COPY --from=build --chown=ledgerguard:ledgerguard /app/.next/static ./.next/static
USER ledgerguard
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
