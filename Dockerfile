# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace config and dependencies
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Install from the lockfile without running the root postinstall before source exists.
RUN npm ci --ignore-scripts --fetch-retries=5 --fetch-retry-maxtimeout=120000
RUN apk add --no-cache openssl qpdf poppler-utils

# Copy source code
COPY packages/shared packages/shared/
COPY apps/api apps/api/
COPY prisma prisma/

# Build shared package and API
RUN npm run build:shared
RUN cd apps/api && npx prisma generate --schema ../../prisma/schema.prisma
RUN npm run build -w apps/api

# ---- Production stage ----
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl qpdf poppler-utils

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/apps/api/dist apps/api/dist/
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/prisma prisma/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run migrations then replace the shell with Node so shutdown signals reach NestJS.
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy --schema ../../prisma/schema.prisma && exec node dist/main.js"]
