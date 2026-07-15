import { resolve } from 'node:path';
import { argument, databaseConnection, runPostgresTool } from './postgres-tools.mjs';

const backupArgument = argument('--backup');
if (!backupArgument) throw new Error('Use --backup <path-to-dump>.');
const backup = resolve(backupArgument);
const connection = databaseConnection();
if (process.env.CONFIRM_DATABASE_RESTORE !== connection.database) {
  throw new Error(`Set CONFIRM_DATABASE_RESTORE=${connection.database} to confirm replacing this database.`);
}

runPostgresTool('pg_restore', [
  ...connection.args,
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-acl',
  '--exit-on-error',
  backup,
], connection.env);
console.log(`Restored ${backup} into ${connection.displayName}.`);
