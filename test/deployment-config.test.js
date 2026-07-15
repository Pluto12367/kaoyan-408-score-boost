import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const railwayConfig = readFileSync(new URL('../railway.toml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('Railway uses the repository Dockerfile with production health and restart policy', () => {
  assert.match(railwayConfig, /builder\s*=\s*"DOCKERFILE"/);
  assert.match(railwayConfig, /dockerfilePath\s*=\s*"Dockerfile"/);
  assert.match(railwayConfig, /healthcheckPath\s*=\s*"\/health"/);
  assert.match(railwayConfig, /healthcheckTimeout\s*=\s*120/);
  assert.match(railwayConfig, /restartPolicyType\s*=\s*"ON_FAILURE"/);
  assert.doesNotMatch(railwayConfig, /^\[service\]/m);
});

test('production image uses supported Node and applies Prisma migrations before startup', () => {
  assert.match(dockerfile, /^FROM node:22-alpine AS builder$/m);
  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.match(dockerfile, /RUN npm ci --ignore-scripts/);
  assert.match(dockerfile, /--fetch-retries=5/);
  assert.match(dockerfile, /--fetch-retry-maxtimeout=120000/);
  assert.ok(
    dockerfile.indexOf('RUN npm ci --ignore-scripts') < dockerfile.indexOf('COPY packages/shared packages/shared/'),
    'dependency installation must happen before source copy so rebuilds retain the dependency cache',
  );
  assert.match(dockerfile, /prisma migrate deploy/);
  assert.match(dockerfile, /exec node dist\/main\.js/);
  assert.doesNotMatch(dockerfile, /apps\/api\/node_modules\/\.prisma/);
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/packages\/shared\/package\.json packages\/shared\//,
  );
  assert.equal(
    dockerfile.match(/RUN apk add --no-cache openssl/g)?.length,
    2,
    'OpenSSL must be installed in both build and runtime stages for Prisma',
  );
});
