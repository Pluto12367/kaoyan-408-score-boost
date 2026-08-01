import { mkdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export interface ImportConfig {
  dataDirectory: string;
  incomingDirectory: string;
  temporaryDirectory: string;
  permanentDirectory: string;
  maxPdfBytes: number;
  maxTableBytes: number;
  temporaryQuotaBytes: number;
  diskStopPercent: number;
}

const defaults = {
  maxPdfBytes: 500 * 1024 * 1024,
  maxTableBytes: 50 * 1024 * 1024,
  temporaryQuotaBytes: 10 * 1024 * 1024 * 1024,
  diskStopPercent: 80,
};

function isContained(parent: string, candidate: string): boolean {
  const remainder = relative(parent, candidate);
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder));
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function childOf(root: string, directory: string): string {
  const candidate = resolve(root, directory);
  if (!isContained(root, candidate) || candidate === root) {
    throw new Error(`Question import directory must be contained beneath QUESTION_IMPORT_DATA_DIR: ${directory}`);
  }
  return candidate;
}

/** Loads the non-public import storage layout and creates its private directories. */
export function loadImportConfig(env: NodeJS.ProcessEnv = process.env): ImportConfig {
  const configuredRoot = env.QUESTION_IMPORT_DATA_DIR;
  if (configuredRoot && !isAbsolute(configuredRoot)) {
    throw new Error('QUESTION_IMPORT_DATA_DIR must be an absolute path');
  }
  const dataDirectory = resolve(configuredRoot ?? resolve(process.cwd(), 'var', 'question-imports'));
  const webRoot = resolve(env.QUESTION_IMPORT_WEB_ROOT ?? resolve(process.cwd(), 'apps', 'web', 'dist'));
  if (isContained(webRoot, dataDirectory) || isContained(dataDirectory, webRoot)) {
    throw new Error('QUESTION_IMPORT_DATA_DIR must not be the web root or contain it');
  }

  const incomingDirectory = childOf(dataDirectory, 'incoming');
  const temporaryDirectory = childOf(dataDirectory, 'temporary');
  const permanentDirectory = childOf(dataDirectory, 'permanent');
  const diskStopPercent = positiveInteger(env.QUESTION_IMPORT_DISK_STOP_PERCENT, defaults.diskStopPercent, 'QUESTION_IMPORT_DISK_STOP_PERCENT');
  if (diskStopPercent > 100) throw new Error('QUESTION_IMPORT_DISK_STOP_PERCENT must not exceed 100');

  for (const directory of [incomingDirectory, temporaryDirectory, permanentDirectory]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  return {
    dataDirectory,
    incomingDirectory,
    temporaryDirectory,
    permanentDirectory,
    maxPdfBytes: positiveInteger(env.QUESTION_IMPORT_MAX_PDF_BYTES, defaults.maxPdfBytes, 'QUESTION_IMPORT_MAX_PDF_BYTES'),
    maxTableBytes: positiveInteger(env.QUESTION_IMPORT_MAX_TABLE_BYTES, defaults.maxTableBytes, 'QUESTION_IMPORT_MAX_TABLE_BYTES'),
    temporaryQuotaBytes: positiveInteger(env.QUESTION_IMPORT_TEMPORARY_QUOTA_BYTES, defaults.temporaryQuotaBytes, 'QUESTION_IMPORT_TEMPORARY_QUOTA_BYTES'),
    diskStopPercent,
  };
}
