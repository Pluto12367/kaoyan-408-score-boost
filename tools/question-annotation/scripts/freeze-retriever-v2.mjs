import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildFinalV2Config,
  finalV2ConfigHash,
  selectV2Winner,
  validateFrozenV2Config,
} from '../core/benchmarkV2.js';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  report: join(TOOL_ROOT, 'local-data', 'benchmark-v2-dev.json'),
  configOut: join(TOOL_ROOT, 'config', 'final-retriever-v2.json'),
  hashOut: join(TOOL_ROOT, 'config', 'final-retriever-v2.sha256'),
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--report') args.report = argv[++index];
    else if (token === '--config-out') args.configOut = argv[++index];
    else if (token === '--hash-out') args.hashOut = argv[++index];
  }
  return args;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${value}\n`, 'utf8');
}

export function freezeRetrieverV2({ report, configOut = DEFAULTS.configOut, hashOut = DEFAULTS.hashOut }) {
  const winner = selectV2Winner(report);
  const config = buildFinalV2Config({
    winner,
    goldSha256: report.goldSha256,
    snapshotId: report.snapshotId,
  });
  const hash = finalV2ConfigHash(config);
  const validation = validateFrozenV2Config(config, hash);
  if (!validation.ok) throw new Error(`invalid final V2 config: ${validation.errors.join('; ')}`);
  writeJson(configOut, config);
  writeText(hashOut, hash);
  return { winner, config, hash, configOut, hashOut };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report ?? DEFAULTS.report;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const result = freezeRetrieverV2({
    report,
    configOut: args.configOut ?? DEFAULTS.configOut,
    hashOut: args.hashOut ?? DEFAULTS.hashOut,
  });
  console.log(`WINNER: ${result.winner.experimentId}`);
  console.log(`selectedOn: ${result.config.selectedOn}`);
  console.log(`HOLDOUT evaluated before freeze: ${result.config.holdoutEvaluatedBeforeFreeze}`);
  console.log(`config hash: ${result.hash}`);
  console.log(`config: ${result.configOut}`);
  console.log(`hash: ${result.hashOut}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[freeze-retriever-v2] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
