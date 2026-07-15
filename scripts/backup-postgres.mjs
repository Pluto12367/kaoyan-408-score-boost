import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argument, databaseConnection, runPostgresTool } from './postgres-tools.mjs';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(argument('--output', `backups/kaoyan408-${timestamp}.dump`));
mkdirSync(dirname(output), { recursive: true });

const connection = databaseConnection();
runPostgresTool('pg_dump', [
  ...connection.args,
  '--format=custom',
  '--no-owner',
  '--no-acl',
  '--file', output,
], connection.env);

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  database: connection.displayName,
  format: 'postgresql-custom',
  file: output,
  sizeBytes: statSync(output).size,
  sha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
};
writeFileSync(`${output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
