import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const railwayConfig = readFileSync(new URL('../railway.toml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const webDockerfile = readFileSync(new URL('../Dockerfile.web', import.meta.url), 'utf8');
const productionCompose = readFileSync(new URL('../compose.production.yml', import.meta.url), 'utf8');
const gatewayConfig = readFileSync(
  new URL('../deploy/tencent-ip/nginx.conf', import.meta.url),
  'utf8',
);
const deploymentWorkflow = readFileSync(
  new URL('../.github/workflows/deploy-pages.yml', import.meta.url),
  'utf8',
);
const stagingSmokeWorkflow = readFileSync(
  new URL('../.github/workflows/staging-smoke.yml', import.meta.url),
  'utf8',
);

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

test('web gateway builds a static SPA and proxies the same-origin API', () => {
  assert.match(webDockerfile, /^FROM node:22-alpine AS builder$/m);
  assert.match(webDockerfile, /ARG VITE_API_BASE_URL=\/api/);
  assert.match(webDockerfile, /^FROM nginx:1\.27-alpine$/m);
  assert.match(gatewayConfig, /location \/api\//);
  assert.match(gatewayConfig, /proxy_pass http:\/\/app:3000\//);
  assert.match(gatewayConfig, /location = \/health/);
  assert.match(gatewayConfig, /try_files \$uri \$uri\/ \/index\.html/);
  assert.match(gatewayConfig, /client_max_body_size 10m/);
});

test('production Compose exposes only the gateway and uses production-safe application settings', () => {
  assert.match(productionCompose, /gateway:/);
  assert.match(productionCompose, /"80:80"/);
  assert.match(productionCompose, /app:/);
  assert.match(productionCompose, /postgres:/);
  assert.doesNotMatch(productionCompose, /"3000:3000"/);
  assert.doesNotMatch(productionCompose, /"5432:5432"/);
  assert.match(productionCompose, /postgres_data:\/var\/lib\/postgresql\/data/);
  assert.match(productionCompose, /restart:\s+unless-stopped/g);
  assert.match(productionCompose, /ALLOW_DEMO_AUTH:\s+"false"/);
  assert.match(productionCompose, /ALLOW_INSECURE_HTTP_IP:\s+"true"/);
  assert.match(productionCompose, /VITE_API_BASE_URL:\s+"\/api"/);
});

test('production backup tooling writes verifiable archives and isolates restore drills', () => {
  const backupScriptPath = new URL('../deploy/tencent-ip/backup.sh', import.meta.url);
  const cronInstallerPath = new URL('../deploy/tencent-ip/install-backup-cron.sh', import.meta.url);
  const restoreScriptPath = new URL('../deploy/tencent-ip/verify-restore.sh', import.meta.url);

  assert.ok(existsSync(backupScriptPath), 'backup.sh must exist');
  assert.ok(existsSync(cronInstallerPath), 'install-backup-cron.sh must exist');
  assert.ok(existsSync(restoreScriptPath), 'verify-restore.sh must exist');

  const backupScript = readFileSync(backupScriptPath, 'utf8');
  const cronInstaller = readFileSync(cronInstallerPath, 'utf8');
  const restoreScript = readFileSync(restoreScriptPath, 'utf8');

  assert.match(productionCompose, /backup:/);
  assert.match(productionCompose, /image:\s*postgres:16-alpine/);
  assert.match(productionCompose, /profiles:\s*\["tools"\]/);
  assert.match(productionCompose, /backup\.sh:\/usr\/local\/bin\/backup\.sh:ro/);
  assert.match(productionCompose, /\.\/backups:\/backups/);
  assert.match(backupScript, /pg_dump/);
  assert.match(backupScript, /sha256sum/);
  assert.match(backupScript, /BACKUP_RETENTION_DAYS/);
  assert.match(backupScript, /-delete/);
  assert.match(restoreScript, /pg_restore/);
  assert.match(restoreScript, /trap cleanup EXIT/);
  assert.match(cronInstaller, /15 3 \* \* \* root/);
  assert.match(cronInstaller, /docker compose --env-file \.env\.production -f compose\.production\.yml --profile tools run --rm backup/);
});

test('CI verifies the production image and uses Node 24 based GitHub actions', () => {
  assert.doesNotMatch(deploymentWorkflow, /actions\/checkout@v4/);
  assert.doesNotMatch(deploymentWorkflow, /actions\/setup-node@v4/);
  assert.equal(
    deploymentWorkflow.match(/actions\/checkout@v5/g)?.length,
    2,
    'both jobs must use the Node 24 based checkout action',
  );
  assert.equal(
    deploymentWorkflow.match(/actions\/setup-node@v5/g)?.length,
    2,
    'both jobs must use the Node 24 based setup-node action',
  );
  assert.match(deploymentWorkflow, /node-version:\s*22/g);
  assert.equal(
    deploymentWorkflow.match(/run: npm ci/g)?.length,
    2,
    'test and deployment jobs must install exactly from package-lock.json',
  );
  assert.match(
    deploymentWorkflow,
    /- name: Build production API image\s+run: docker build --tag kaoyan408-api:ci \./,
  );
});

test('staging smoke is manual and reads credentials only from GitHub secrets', () => {
  assert.match(stagingSmokeWorkflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(stagingSmokeWorkflow, /^\s*(push|pull_request|schedule):\s*$/m);
  assert.match(stagingSmokeWorkflow, /STAGING_API_URL:\s*\$\{\{ vars\.STAGING_API_URL \}\}/);
  assert.match(stagingSmokeWorkflow, /STAGING_WEB_ORIGIN:\s*\$\{\{ vars\.STAGING_WEB_ORIGIN \}\}/);
  assert.match(stagingSmokeWorkflow, /STAGING_SMOKE_EMAIL:\s*\$\{\{ secrets\.STAGING_SMOKE_EMAIL \}\}/);
  assert.match(stagingSmokeWorkflow, /STAGING_SMOKE_PASSWORD:\s*\$\{\{ secrets\.STAGING_SMOKE_PASSWORD \}\}/);
  assert.match(stagingSmokeWorkflow, /run: npm run smoke:staging/);
});
