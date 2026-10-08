# Minimal production image for the LedgerGuard Next.js app.
# Builds on next.config.mjs's `output: 'standalone'` — this image contains
# only the app itself. Postgres and DataHub are separate services (see
# docker-compose.demo.yml and docs/archive/hackathon/deployment.md); this image does not bundle
# or start either.

FROM node:24-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY . .
# The app currently has no public assets; retain a valid optional assets path.
RUN mkdir -p public && pnpm run build

FROM node:24-alpine AS runner
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
