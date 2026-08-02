import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { argument, runPostgresTool } from './postgres-tools.mjs';

function checksum(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function verifyChecksum(path, expected) {
  const actual = checksum(readFileSync(path));
  if (actual !== expected) throw new Error(`Backup checksum does not match for ${path}.`);
  return actual;
}

function selfCheck() {
  const directory = mkdtempSync(join(tmpdir(), 'kaoyan408-backup-self-check-'));
  try {
    const dump = join(directory, 'fixture.dump');
    const dumpBytes = Buffer.from('postgres-custom-backup-fixture-v1\n', 'utf8');
    writeFileSync(dump, dumpBytes);
    writeFileSync(`${dump}.manifest.json`, JSON.stringify({ version: 1, format: 'postgresql-custom', sha256: checksum(dumpBytes) }));
    const manifest = JSON.parse(readFileSync(`${dump}.manifest.json`, 'utf8'));
    verifyChecksum(dump, manifest.sha256);

    const assetArchive = join(directory, 'fixture.assets.tar.gz');
    const assetPayload = Buffer.from('permanent/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg\n', 'utf8');
    writeFileSync(assetArchive, gzipSync(assetPayload, { mtime: 0 }));
    const assetChecksum = verifyChecksum(assetArchive, checksum(readFileSync(assetArchive)));
    if (!gunzipSync(readFileSync(assetArchive)).equals(assetPayload)) throw new Error('Asset archive integrity check failed.');

    return { ok: true, mode: 'self-check', backupIntegrity: true, assetArchive: true, checksum: assetChecksum };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const backupArgument = argument('--backup', process.argv[2]);
if (!backupArgument) {
  console.log(JSON.stringify(selfCheck(), null, 2));
} else {
  const backup = resolve(backupArgument);
  const manifest = JSON.parse(readFileSync(`${backup}.manifest.json`, 'utf8'));
  const actualChecksum = verifyChecksum(backup, manifest.sha256);
  const listing = runPostgresTool('pg_restore', ['--list', backup], process.env);
  const entries = listing.split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
  if (entries === 0) throw new Error('Backup archive contains no restorable entries.');
  console.log(JSON.stringify({ ok: true, mode: 'production', backup, checksum: actualChecksum, entries }, null, 2));
}
