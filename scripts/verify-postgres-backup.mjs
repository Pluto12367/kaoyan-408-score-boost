import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argument, runPostgresTool } from './postgres-tools.mjs';

const backupArgument = argument('--backup', process.argv[2]);
if (!backupArgument) throw new Error('Use --backup <path-to-dump>.');
const backup = resolve(backupArgument);
const manifest = JSON.parse(readFileSync(`${backup}.manifest.json`, 'utf8'));
const actualChecksum = createHash('sha256').update(readFileSync(backup)).digest('hex');
if (actualChecksum !== manifest.sha256) throw new Error('Backup checksum does not match its manifest.');

const listing = runPostgresTool('pg_restore', ['--list', backup], process.env);
const entries = listing.split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
if (entries === 0) throw new Error('Backup archive contains no restorable entries.');
console.log(JSON.stringify({ ok: true, backup, checksum: actualChecksum, entries }, null, 2));
