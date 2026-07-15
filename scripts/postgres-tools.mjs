import { spawnSync } from 'node:child_process';

export function databaseConnection(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name.');
  const args = [
    '--host', url.hostname,
    '--port', url.port || '5432',
    '--username', decodeURIComponent(url.username),
    '--dbname', database,
  ];
  const env = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(url.password),
    ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
  };
  return { args, env, database, displayName: `${url.hostname}:${url.port || '5432'}/${database}` };
}

export function runPostgresTool(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
