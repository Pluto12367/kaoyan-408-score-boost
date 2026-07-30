import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const railwayConfig = readFileSync(new URL('../railway.toml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const webDockerfile = readFileSync(new URL('../Dockerfile.web', import.meta.url), 'utf8');
const productionCompose = readFileSync(new URL('../compose.production.yml', import.meta.url), 'utf8');
const productionEnvTemplate = readFileSync(
  new URL('../deploy/tencent-ip/.env.production.example', import.meta.url),
  'utf8',
);
const deploymentGuide = readFileSync(new URL('../docs/deploy-to-tencent-ip.md', import.meta.url), 'utf8');
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

function composeServiceBlock(compose, serviceName) {
  const match = compose.match(
    new RegExp(`^  ${serviceName}:\\n[\\s\\S]*?(?=^  [A-Za-z0-9_-]+:|^volumes:)`, 'm'),
  );
  assert.ok(match, `${serviceName} service block must exist`);
  return match[0];
}

function assertHealthLoopHonorsRemainingDeadline(script, scriptName) {
  const healthLoop = script.match(/wait_for_gateway\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(healthLoop, `${scriptName} must define wait_for_gateway`);
  assert.match(healthLoop, /deadline=\$\(\( \$\(date \+%s\) \+ 60 \)\)/);
  assert.match(healthLoop, /now=\$\(date \+%s\)/);
  assert.match(healthLoop, /remaining=\$\(\(deadline - now\)\)/);
  assert.match(healthLoop, /if \[ "\$remaining" -le 0 \]; then[\s\S]*?return 1/);
  assert.match(healthLoop, /curl_timeout=2[\s\S]*?curl_timeout=\$remaining/);
  assert.match(healthLoop, /curl -fsS --connect-timeout 1 --max-time "\$curl_timeout" http:\/\/127\.0\.0\.1\/health/);

  const firstDeadlineCheck = healthLoop.indexOf('if [ "$remaining" -le 0 ]');
  const curlIndex = healthLoop.indexOf('curl -fsS');
  const secondNow = healthLoop.indexOf('now=$(date +%s)', curlIndex);
  const secondDeadlineCheck = healthLoop.indexOf('if [ "$remaining" -le 0 ]', curlIndex);
  const sleepIndex = healthLoop.indexOf('sleep 1');
  assert.ok(firstDeadlineCheck >= 0 && firstDeadlineCheck < curlIndex, `${scriptName} must check the deadline before curl`);
  assert.ok(secondNow >= 0 && secondDeadlineCheck > secondNow && secondDeadlineCheck < sleepIndex, `${scriptName} must recheck the deadline before sleeping`);
}

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
  assert.doesNotMatch(productionCompose, /^name:\s*\S+/m);
  assert.match(productionCompose, /gateway:/);
  assert.match(productionCompose, /"80:80"/);
  assert.match(productionCompose, /app:/);
  assert.match(productionCompose, /postgres:/);
  assert.doesNotMatch(productionCompose, /"3000:3000"/);
  assert.doesNotMatch(productionCompose, /"5432:5432"/);
  assert.match(productionCompose, /postgres_data:\/var\/lib\/postgresql\/data/);
  assert.match(productionCompose, /restart:\s+unless-stopped/g);
  assert.match(productionCompose, /ALLOW_DEMO_AUTH:\s+"false"/);
  assert.match(productionCompose, /WEB_ORIGIN:\s*\$\{WEB_ORIGIN:-http:\/\/\$\{PUBLIC_IP\}\}/);
  assert.match(productionCompose, /ALLOW_INSECURE_HTTP_IP:\s*\$\{ALLOW_INSECURE_HTTP_IP:-true\}/);
  assert.match(productionCompose, /VITE_API_BASE_URL:\s+"\/api"/);
  assert.match(productionEnvTemplate, /WEB_ORIGIN=/);
  assert.match(productionEnvTemplate, /ALLOW_INSECURE_HTTP_IP=false/);
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
  const backupService = composeServiceBlock(productionCompose, 'backup');

  assert.match(backupService, /image:\s*postgres:16-alpine/);
  assert.match(backupService, /profiles:\s*\["tools"\]/);
  assert.match(backupService, /backup\.sh:\/usr\/local\/bin\/backup\.sh:ro/);
  assert.match(backupService, /\.\/backups:\/backups/);
  assert.match(backupService, /depends_on:\s+postgres:\s+condition:\s+service_healthy/);
  assert.match(backupScript, /pg_dump/);
  assert.match(backupScript, /cd "\$backup_dir" && sha256sum/);
  assert.doesNotMatch(backupScript, /sha256sum "\$backup_path"/);
  assert.match(backupScript, /BACKUP_RETENTION_DAYS/);
  assert.match(backupScript, /-delete/);
  assert.match(restoreScript, /restore_id="\$\(date -u .*\)-\$\$"/);
  assert.match(restoreScript, /container_name="kaoyan408-restore-drill-\$restore_id"/);
  assert.match(restoreScript, /network_name="kaoyan408-restore-network-\$restore_id"/);
  assert.match(restoreScript, /docker network create "\$network_name"/);
  assert.match(restoreScript, /docker run -d[\s\S]*?--name "\$container_name"[\s\S]*?--network "\$network_name"/);
  assert.match(restoreScript, /docker exec -e PGPASSWORD="\$restore_password" "\$container_name"\s+\\\n  pg_restore --exit-on-error/);
  assert.match(restoreScript, /trap cleanup EXIT/);
  assert.match(restoreScript, /network_created=false/);
  assert.match(restoreScript, /container_created=false/);
  assert.match(restoreScript, /docker network create "\$network_name"[^\n]*\nnetwork_created=true/);
  assert.match(restoreScript, /postgres:16-alpine >\/dev\/null\ncontainer_created=true/);
  assert.match(restoreScript, /if \[ "\$container_created" = true \]; then\s+docker rm -f "\$container_name"/);
  assert.match(restoreScript, /if \[ "\$network_created" = true \]; then\s+docker network rm "\$network_name"/);
  assert.doesNotMatch(restoreScript, /compose\.production/);
  assert.doesNotMatch(restoreScript, /DATABASE_URL/);
  assert.doesNotMatch(restoreScript, /PGHOST=postgres/);
  assert.doesNotMatch(restoreScript, /postgres_data/);
  assert.doesNotMatch(restoreScript, /(?:docker compose|docker exec)\s+postgres[\s\S]*pg_restore/);
  assert.match(cronInstaller, /15 3 \* \* \* root/);
  assert.match(cronInstaller, /docker compose --env-file \.env\.production -f compose\.production\.yml --profile tools run --rm backup/);
});

test('Tencent IP deployment scripts preserve database volumes, validate production secrets, and use bounded health gates', () => {
  const deployScriptPath = new URL('../deploy/tencent-ip/deploy.sh', import.meta.url);
  const rollbackScriptPath = new URL('../deploy/tencent-ip/rollback.sh', import.meta.url);

  assert.ok(existsSync(deployScriptPath), 'deploy.sh must exist');
  assert.ok(existsSync(rollbackScriptPath), 'rollback.sh must exist');

  const deployScript = readFileSync(deployScriptPath, 'utf8');
  const rollbackScript = readFileSync(rollbackScriptPath, 'utf8');

  assert.match(deployScript, /docker compose .* config/);
  assert.match(deployScript, /docker compose --env-file \.env\.production -f compose\.production\.yml config --format json/);
  assert.match(deployScript, /compose_project=\$\(printf '%s\\n' "\$compose_config" \| sed -n -E .*"name".*\| sed -n '1p'\)/);
  assert.match(deployScript, /Could not determine the Compose project name/);
  assert.match(deployScript, /ps --all -q postgres/);
  assert.match(deployScript, /docker volume ls --filter "label=com\.docker\.compose\.project=\$compose_project" --filter 'label=com\.docker\.compose\.volume=postgres_data' -q/);
  assert.match(deployScript, /--profile tools run --rm backup/);
  assert.match(deployScript, /up -d --build --wait/);
  assert.match(deployScript, /POSTGRES_USER/);
  assert.match(deployScript, /POSTGRES_PASSWORD/);
  assert.match(deployScript, /POSTGRES_DB/);
  assert.match(deployScript, /JWT_SECRET/);
  assert.match(deployScript, /BACKUP_RETENTION_DAYS/);
  assert.match(deployScript, /generate-a-base64url-password/);
  assert.match(deployScript, /generate-a-random-secret/);
  assertHealthLoopHonorsRemainingDeadline(deployScript, 'deploy.sh');
  assert.doesNotMatch(deployScript, /down -v/);
});

test('Tencent IP rollback verifies the target before backing up and restores a healthy original application on failure', () => {
  const rollbackScript = readFileSync(new URL('../deploy/tencent-ip/rollback.sh', import.meta.url), 'utf8');

  assert.doesNotMatch(rollbackScript, /down -v/);
  assert.match(rollbackScript, /git rev-parse --verify "\$1\^\{commit\}"/);
  assert.match(rollbackScript, /git status --porcelain --untracked-files=all/);
  assert.match(rollbackScript, /original_commit=\$\(git rev-parse --verify HEAD\)/);
  assert.match(rollbackScript, /trap restore_original EXIT/);
  assert.match(rollbackScript, /git switch --detach "\$target_commit"/);
  assert.match(rollbackScript, /git switch --detach "\$original_commit"/);
  assertHealthLoopHonorsRemainingDeadline(rollbackScript, 'rollback.sh');
  const recoveryStart = rollbackScript.indexOf('restore_original() {');
  const recoveryEnd = rollbackScript.indexOf('trap restore_original EXIT');
  assert.ok(recoveryStart >= 0, 'rollback must define automatic recovery');
  assert.ok(recoveryEnd > recoveryStart, 'rollback must install the recovery trap after defining it');
  const recoveryFunction = rollbackScript.slice(recoveryStart, recoveryEnd);
  assert.match(
    recoveryFunction,
    /database migrations are not rolled back automatically/,
    'automatic recovery must repeat the migration warning',
  );
  const backupIndex = rollbackScript.indexOf('--profile tools run --rm backup');
  const originalCommitIndex = rollbackScript.indexOf('original_commit=');
  assert.ok(backupIndex >= 0, 'rollback must invoke the backup tool');
  assert.ok(originalCommitIndex >= 0, 'rollback must record the original commit');
  assert.ok(
    backupIndex < originalCommitIndex,
    'rollback must create the backup before recording and switching versions',
  );
  assert.ok(
    rollbackScript.indexOf('database migrations are not rolled back automatically')
      < rollbackScript.indexOf('git switch --detach "$target_commit"'),
    'rollback must warn about migrations before changing application code',
  );
});

test('HTTPS guide describes a future topology instead of implying the HTTP pilot gains TLS from environment values alone', () => {
  assert.match(deploymentGuide, /当前镜像只公开 80 端口/);
  assert.match(deploymentGuide, /不能只改环境变量获得 HTTPS/);
  assert.match(deploymentGuide, /443 ssl/);
  assert.match(deploymentGuide, /80.*重定向/);
  assert.match(deploymentGuide, /只读挂载/);
  assert.match(deploymentGuide, /"443:443"/);
  assert.match(deploymentGuide, /ALLOW_INSECURE_HTTP_IP=false/);
  assert.match(deploymentGuide, /关闭旧 IP 入口/);
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
