# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace config and dependencies
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/nest-cli.json apps/api/
COPY apps/api/tsconfig.json apps/api/

# Install all dependencies
RUN npm install

# Copy source code
COPY packages/shared packages/shared/
COPY apps/api apps/api/
COPY prisma prisma/

# Build shared package and API
RUN npm run build:shared
RUN cd apps/api && npx prisma generate --schema ../../prisma/schema.prisma
RUN npm run build -w apps/api

# ---- Production stage ----
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/apps/api/dist apps/api/dist/
COPY --from=builder /app/apps/api/node_modules/.prisma apps/api/node_modules/.prisma/
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/prisma prisma/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run migrations then start server
CMD cd apps/api && npx prisma migrate deploy --schema ../../prisma/schema.prisma && node dist/main.js
