# ── apps/api/Dockerfile — Artha AI API Production Image ────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and package manifests for caching
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/phase5-strategy/package.json ./packages/phase5-strategy/
COPY packages/phase2-market-data/package.json ./packages/phase2-market-data/
COPY apps/api/package.json ./apps/api/

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy source files
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build TypeScript
RUN npm run build --workspace=apps/api || npx tsc --project apps/api/tsconfig.json

# ── Runner Stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy node_modules and built code from builder stage
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

# Create directory for persistent SQLite data
RUN mkdir -p /app/apps/api/data && chown -node:node /app/apps/api/data

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "apps/api/dist/server.js"]
