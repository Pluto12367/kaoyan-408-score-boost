import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import {
  GOLD_CONTRACT_V2,
  GOLD_CONTRACT_V2_FORTY,
  createGoldSet,
  createGoldSetV2,
  createGoldSetV2Forty,
  freezeGoldManifest,
  freezeGoldManifestV2,
  freezeGoldManifestV2Forty,
  loadGoldSet,
  loadGoldSetV2,
  loadGoldSetV2Forty,
  saveGoldSet,
  validateGoldEntry,
} from '../core/gold.js';
import { buildGoldManifest } from '../core/sample.js';
import {
  V2_GOLD_SAMPLE_VERSION,
  V2R_GOLD_SAMPLE_VERSION,
  V2R2_ACCEPTED_SAMPLE_SHA256,
  V2R2_GOLD_SAMPLE_VERSION,
  V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256,
  V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256,
  buildV2R2SampleManifest,
  validateV2SplitManifest,
} from '../core/sampleV2.js';
import {
  V2_FORTY_GOLD_SAMPLE_VERSION,
  validateV2FortySplitManifest,
} from '../core/sampleV2Forty.js';
import {
  getWorkspaceSummary,
  listNodes,
  listQuestions,
  openWorkspace,
  validateWorkspace,
} from '../workspace/workspace.mjs';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS_V1 = {
  workspace: join(TOOL_ROOT, 'local-data', 'annotation-workspace.db'),
  sample: join(TOOL_ROOT, 'local-data', 'gold-sample-v1.json'),
  goldSet: join(TOOL_ROOT, 'local-data', 'gold-set-v1.json'),
  manifestOut: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
};
const DEFAULTS_V2 = {
  workspace: DEFAULTS_V1.workspace,
  sample: join(TOOL_ROOT, 'local-data', 'gold-sample-v2r2.json'),
  split: join(TOOL_ROOT, 'local-data', 'gold-split-v2.json'),
  goldSet: join(TOOL_ROOT, 'local-data', 'gold-set-v2.json'),
  manifestOut: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v2.json'),
};
const DEFAULTS_V2_FORTY = {
  workspace: DEFAULTS_V1.workspace,
  sample: join(TOOL_ROOT, 'local-data', 'gold-sample-v2r2-40.json'),
  split: join(TOOL_ROOT, 'local-data', 'gold-split-v2r2-40.json'),
  goldSet: join(TOOL_ROOT, 'local-data', 'gold-set-v2r2-40.json'),
  manifestOut: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v2r2-40.json'),
};
const DEFAULT_GOLD_VERSION = 'gold-truth-v1';
const DEFAULT_GOLD_VERSION_V2 = 'gold-truth-v2';
const DEFAULT_GOLD_VERSION_V2_FORTY = 'gold-truth-v2r2-40';
const VALID_SUBJECTS = ['DS', 'CO', 'OS', 'CN'];

export function resolveGoldAuthoringConfig(flags = {}) {
  const isV2 = flags.goldVersion === 'v2';
  const isV2Forty = flags.goldVersion === 'v2-40';
  const mode = isV2Forty ? 'v2-40' : (isV2 ? 'v2' : 'v1');
  const defaults = isV2Forty ? DEFAULTS_V2_FORTY : (isV2 ? DEFAULTS_V2 : DEFAULTS_V1);
  return {
    mode,
    workspace: flags.workspace ?? defaults.workspace,
    sample: flags.sample ?? defaults.sample,
    split: mode !== 'v1' ? (flags.split ?? defaults.split) : undefined,
    goldSet: flags.goldSet ?? defaults.goldSet,
    manifestOut: flags.manifestOut ?? defaults.manifestOut,
    finalGoldVersion: isV2Forty
      ? DEFAULT_GOLD_VERSION_V2_FORTY
      : (isV2 ? DEFAULT_GOLD_VERSION_V2 : (flags.goldVersion ?? DEFAULT_GOLD_VERSION)),
    total: isV2Forty ? GOLD_CONTRACT_V2_FORTY.total : (isV2 ? GOLD_CONTRACT_V2.total : 40),
    hideSplit: mode !== 'v1',
  };
}

function printHelp() {
  console.log(`usage: node tools/question-annotation/scripts/gold-author.mjs <command> [options]

commands:
  status                              show authoring progress
  list                                list frozen gold questions and authoring status
  next                                show the next unconfirmed question (content shown locally)
  show <questionId>                   show a question and its current selection
  search-nodes <query> --subject <code>   search active atomic nodes of one subject (DS/CO/OS/CN)
  set <questionId> --primary <nodeId> [--secondary <nodeId> ...]
  confirm <questionId>                lock a valid selection as human-confirmed
  reopen <questionId>                 move a confirmed question back to draft
  freeze                              write the final frozen Gold Truth manifest (40 V1, 100 V2, or 40 V2-40)
  exit | quit                         leave the interactive session

options:
  --workspace <path>    annotation workspace db (default: local-data/annotation-workspace.db)
  --sample <path>       frozen Task 4 gold sample json (default: local-data/gold-sample-v1.json)
  --split <path>        V2 frozen split json (default in V2: local-data/gold-split-v2.json)
  --gold-set <path>     authoring state json (default: local-data/gold-set-v1.json)
  --manifest-out <path> final manifest output (default: local-data/gold-truth-manifest-v1.json)
  --gold-version <v>    use v2 or v2-40 for isolated authoring; otherwise V1 final goldVersion

Run without a command to start the interactive session.`);
}

function parseArgs(argv) {
  const args = { command: null, positionals: [], flags: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') args.flags.workspace = argv[++index];
    else if (token === '--sample') args.flags.sample = argv[++index];
    else if (token === '--split') args.flags.split = argv[++index];
    else if (token === '--gold-set') args.flags.goldSet = argv[++index];
    else if (token === '--manifest-out') args.flags.manifestOut = argv[++index];
    else if (token === '--gold-version') args.flags.goldVersion = argv[++index];
    else if (token === '--primary') args.flags.primary = argv[++index];
    else if (token === '--secondary') {
      const values = [];
      while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
        values.push(argv[index + 1]);
        index += 1;
      }
      args.flags.secondary = values;
    } else if (token === '--subject') args.flags.subject = argv[++index];
    else if (token === '--help' || token === '-h') args.flags.help = true;
    else if (args.command === null) args.command = token;
    else args.positionals.push(token);
  }
  return args;
}

function buildFrozenAuthoringContract({ snapshotId, sampleEntries, split, contract, sampleVersion, label }) {
  if (!Array.isArray(sampleEntries) || sampleEntries.length !== contract.total) {
    throw new Error(`${label} frozen sample must have ${contract.total} entries, got ${sampleEntries?.length ?? 'none'}`);
  }
  const dev = Array.isArray(split?.dev) ? split.dev : [];
  const holdout = Array.isArray(split?.holdout) ? split.holdout : [];
  if (dev.length !== contract.dev || holdout.length !== contract.holdout) {
    throw new Error(`${label} frozen split must be ${contract.dev}/${contract.holdout}, got ${dev.length}/${holdout.length}`);
  }
  const splitByQuestion = new Map();
  for (const [splitLabel, ids] of [['DEV', dev], ['HOLDOUT', holdout]]) {
    for (const questionId of ids) {
      if (typeof questionId !== 'string' || questionId.length === 0) {
        throw new Error(`${label} frozen split ${splitLabel} contains invalid question id`);
      }
      if (splitByQuestion.has(questionId)) throw new Error(`${label} frozen split duplicate question ${questionId}`);
      splitByQuestion.set(questionId, splitLabel);
    }
  }
  const seen = new Set();
  const entries = sampleEntries.map((entry) => {
    if (!entry || typeof entry.questionId !== 'string' || entry.questionId.length === 0) {
      throw new Error(`${label} frozen sample contains invalid question id`);
    }
    if (seen.has(entry.questionId)) throw new Error(`${label} frozen sample duplicate question ${entry.questionId}`);
    seen.add(entry.questionId);
    const frozenSplit = splitByQuestion.get(entry.questionId);
    if (!frozenSplit) throw new Error(`${label} frozen sample question ${entry.questionId} missing from split`);
    if (typeof entry.contentFingerprint !== 'string' || entry.contentFingerprint.length === 0) {
      throw new Error(`${label} frozen sample fingerprint missing for ${entry.questionId}`);
    }
    return {
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      subject: entry.subject,
      split: frozenSplit,
    };
  }).sort((left, right) => left.questionId.localeCompare(right.questionId));
  if (splitByQuestion.size !== entries.length) {
    throw new Error(`${label} frozen split unique ids ${splitByQuestion.size} != sample entries ${entries.length}`);
  }
  const manifest = buildGoldManifest({
    goldVersion: sampleVersion,
    snapshotId,
    entries: entries.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  return { entries, manifestSha256: manifest.sha256 };
}

export function buildFrozenV2AuthoringContract({ snapshotId, sampleEntries, split }) {
  return buildFrozenAuthoringContract({
    snapshotId,
    sampleEntries,
    split,
    contract: GOLD_CONTRACT_V2,
    sampleVersion: V2R2_GOLD_SAMPLE_VERSION,
    label: 'V2',
  });
}

export function buildFrozenV2FortyAuthoringContract({ snapshotId, sampleEntries, split }) {
  return buildFrozenAuthoringContract({
    snapshotId,
    sampleEntries,
    split,
    contract: GOLD_CONTRACT_V2_FORTY,
    sampleVersion: V2_FORTY_GOLD_SAMPLE_VERSION,
    label: 'V2-40',
  });
}

export function prepareV2AuthoringSample({ sample, splitManifest }) {
  if (
    sample?.goldVersion === V2_GOLD_SAMPLE_VERSION
    || sample?.goldVersion === V2R_GOLD_SAMPLE_VERSION
    || sample?.sha256 === V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256
    || sample?.sha256 === V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256
  ) {
    throw new Error('REJECTED_PRE_SPLIT_SAMPLE cannot be used for V2 Gold authoring');
  }
  if (sample?.goldVersion !== V2R2_GOLD_SAMPLE_VERSION) {
    throw new Error(`V2 Gold authoring requires ${V2R2_GOLD_SAMPLE_VERSION}`);
  }
  if (sample.sha256 !== V2R2_ACCEPTED_SAMPLE_SHA256) {
    throw new Error(`V2 Gold authoring sample SHA ${sample.sha256} != accepted SHA ${V2R2_ACCEPTED_SAMPLE_SHA256}`);
  }
  const recomputed = buildV2R2SampleManifest({
    snapshotId: sample.snapshotId,
    contentSha256: sample.contentSha256,
    entries: sample.entries,
  });
  if (recomputed.sha256 !== sample.sha256) {
    throw new Error('V2 Gold authoring sample sha256 mismatch');
  }
  const splitValidation = validateV2SplitManifest(splitManifest);
  if (!splitValidation.ok) {
    throw new Error(`V2 Gold authoring split invalid: ${splitValidation.errors.join('; ')}`);
  }
  if (splitManifest.snapshotId !== sample.snapshotId) {
    throw new Error(`V2 Gold authoring split snapshot ${splitManifest.snapshotId} != sample ${sample.snapshotId}`);
  }
  if (splitManifest.sampleSha256 !== sample.sha256) {
    throw new Error('V2 Gold authoring split sample SHA mismatch');
  }
  return buildFrozenV2AuthoringContract({
    snapshotId: sample.snapshotId,
    sampleEntries: sample.entries,
    split: splitManifest.split,
  });
}

export function prepareV2FortyAuthoringSample({ sample, splitManifest }) {
  if (sample?.goldVersion !== V2_FORTY_GOLD_SAMPLE_VERSION) {
    throw new Error(`V2-40 Gold authoring requires ${V2_FORTY_GOLD_SAMPLE_VERSION}`);
  }
  if (sample.parentSampleSha256 !== V2R2_ACCEPTED_SAMPLE_SHA256) {
    throw new Error('V2-40 Gold authoring parent sample SHA mismatch');
  }
  const splitValidation = validateV2FortySplitManifest(splitManifest, sample);
  if (!splitValidation.ok) {
    throw new Error(`V2-40 Gold authoring split invalid: ${splitValidation.errors.join('; ')}`);
  }
  if (splitManifest.snapshotId !== sample.snapshotId) {
    throw new Error(`V2-40 Gold authoring split snapshot ${splitManifest.snapshotId} != sample ${sample.snapshotId}`);
  }
  if (splitManifest.sampleSha256 !== sample.sha256) {
    throw new Error('V2-40 Gold authoring split sample SHA mismatch');
  }
  return buildFrozenV2FortyAuthoringContract({
    snapshotId: sample.snapshotId,
    sampleEntries: sample.entries,
    split: splitManifest.split,
  });
}

function loadContext({ workspacePath, samplePath, splitPath, mode }) {
  const db = openWorkspace(workspacePath);
  const summary = getWorkspaceSummary(db);
  const workspaceValidation = validateWorkspace(db);
  const questions = listQuestions(db);
  const nodes = listNodes(db);
  db.close();
  if (!workspaceValidation.ok) {
    throw new Error(`workspace invalid: ${workspaceValidation.errors.join('; ')}`);
  }
  if (!existsSync(samplePath)) {
    throw new Error(`frozen sample not found: ${samplePath}`);
  }
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
  if (sample.snapshotId !== summary.snapshotId) {
    throw new Error(`frozen sample snapshot ${sample.snapshotId} does not match workspace ${summary.snapshotId}`);
  }
  let sampleEntries = sample.entries ?? [];
  let frozenManifestSha256 = sample.manifestSha256;
  if (mode === 'v2' || mode === 'v2-40') {
    if (!existsSync(splitPath)) throw new Error(`frozen V2 split not found: ${splitPath}`);
    const splitManifest = JSON.parse(readFileSync(splitPath, 'utf8'));
    const prepared = mode === 'v2-40'
      ? prepareV2FortyAuthoringSample({ sample, splitManifest })
      : prepareV2AuthoringSample({ sample, splitManifest });
    sampleEntries = prepared.entries;
    frozenManifestSha256 = prepared.manifestSha256;
  } else if (sampleEntries.length !== 40) {
    throw new Error(`frozen sample must have 40 entries, got ${sampleEntries.length}`);
  }
  const questionById = new Map(questions.map((question) => [question.questionId, question]));
  for (const entry of sampleEntries) {
    const question = questionById.get(entry.questionId);
    if (!question) throw new Error(`frozen sample question ${entry.questionId} missing from workspace`);
    if (question.contentFingerprint !== entry.contentFingerprint) {
      throw new Error(`frozen sample fingerprint drift for ${entry.questionId}`);
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const maps = {
    nodeIds,
    nodeSubject: new Map(nodes.map((node) => [node.nodeId, node.subject])),
    nodeActive: new Set(nodes.filter((node) => node.isActive).map((node) => node.nodeId)),
    nodeAtomic: new Set(nodes.filter((node) => node.nodeType === 'atomicPoint').map((node) => node.nodeId)),
    byQuestion: new Map(questions.map((question) => [question.questionId, { subject: question.subject }])),
    fingerprintByQuestion: new Map(questions.map((question) => [question.questionId, question.contentFingerprint])),
  };
  const snapshotForFreeze = {
    snapshotId: summary.snapshotId,
    questions: questions.map((question) => ({
      id: question.questionId,
      subject: question.subject,
      contentFingerprint: question.contentFingerprint,
      isCurrent: question.isCurrent,
    })),
    nodes: nodes.map((node) => ({ id: node.nodeId, subject: node.subject, nodeType: node.nodeType, isActive: node.isActive })),
  };
  return {
    summary,
    questions,
    nodes,
    sample: { ...sample, entries: sampleEntries, manifestSha256: frozenManifestSha256 },
    maps,
    questionById,
    snapshotForFreeze,
  };
}

function loadOrCreateGoldSet({ goldSetPath, sample, snapshotId, mode }) {
  const frozen = sample.entries.map((entry) => ({
    questionId: entry.questionId,
    contentFingerprint: entry.contentFingerprint,
    subject: entry.subject,
    split: entry.split,
  }));
  const frozenManifestSha256 = sample.manifestSha256;
  const create = mode === 'v2-40' ? createGoldSetV2Forty : (mode === 'v2' ? createGoldSetV2 : createGoldSet);
  const load = mode === 'v2-40' ? loadGoldSetV2Forty : (mode === 'v2' ? loadGoldSetV2 : loadGoldSet);
  let goldSet = load(goldSetPath);
  if (!goldSet) {
    goldSet = create({ snapshotId, frozen, frozenManifestSha256 });
    saveGoldSet(goldSetPath, goldSet);
    return goldSet;
  }
  if (goldSet.snapshotId !== snapshotId) {
    throw new Error(`gold set snapshot drift: ${goldSet.snapshotId} != ${snapshotId}`);
  }
  if (goldSet.frozenManifestSha256 !== frozenManifestSha256) {
    throw new Error('gold set frozen sample drift (frozen manifest sha256 mismatch)');
  }
  return goldSet;
}

function validationContext(ctx) {
  return {
    nodeActive: ctx.maps.nodeActive,
    nodeAtomic: ctx.maps.nodeAtomic,
    frozenQuestionIds: new Set(ctx.goldSet.frozen.map((entry) => entry.questionId)),
    contentFingerprintByQuestion: ctx.maps.fingerprintByQuestion,
    splitByQuestion: new Map(ctx.goldSet.frozen.map((entry) => [entry.questionId, entry.split])),
  };
}

function nextUnconfirmed(ctx) {
  return ctx.goldSet.frozen.find((entry) => ctx.goldSet.authoring[entry.questionId].status !== 'confirmed')?.questionId ?? null;
}

export function formatAuthoringListLine(frozen, authored, { hideSplit = false } = {}) {
  const columns = [frozen.questionId, frozen.subject];
  if (!hideSplit) columns.push(frozen.split);
  columns.push(authored.status);
  return columns.join('\t');
}

export function formatAuthoringQuestionHeader(question, frozen, authored, { hideSplit = false } = {}) {
  const fields = [`question: ${question.questionId}`, `subject: ${question.subject}`];
  if (!hideSplit) fields.push(`split: ${frozen.split}`);
  fields.push(`status: ${authored.status}`);
  return fields.join('  ');
}

function printStatus(ctx) {
  const authoring = Object.values(ctx.goldSet.authoring);
  const confirmed = authoring.filter((entry) => entry.status === 'confirmed').length;
  const draft = authoring.filter((entry) => entry.status === 'draft').length;
  const unstarted = ctx.config.total - confirmed - draft;
  console.log(`gold set: ${ctx.goldSet.snapshotId} (frozen manifest ${ctx.goldSet.frozenManifestSha256.slice(0, 12)}...)`);
  console.log(`progress: ${confirmed}/${ctx.config.total} confirmed, ${draft} draft, ${unstarted} unstarted`);
  const nextId = nextUnconfirmed(ctx);
  console.log(`next unconfirmed: ${nextId ?? `(all ${ctx.config.total} confirmed)`}`);
}

function printList(ctx) {
  for (const entry of ctx.goldSet.frozen) {
    const authored = ctx.goldSet.authoring[entry.questionId];
    console.log(formatAuthoringListLine(entry, authored, { hideSplit: ctx.config.hideSplit }));
  }
}

function showQuestion(ctx, questionId) {
  const question = ctx.questionById.get(questionId);
  if (!question) throw new Error(`unknown question ${questionId}`);
  const authored = ctx.goldSet.authoring[questionId];
  if (!authored) throw new Error(`question ${questionId} is not a frozen gold question`);
  const frozen = ctx.goldSet.frozen.find((entry) => entry.questionId === questionId);
  console.log(formatAuthoringQuestionHeader(question, frozen, authored, { hideSplit: ctx.config.hideSplit }));
  console.log(`difficulty: ${question.difficulty ?? 'n/a'}  source: ${question.source ?? 'n/a'}  year: ${question.year ?? 'n/a'}`);
  console.log('--- stem ---');
  console.log(question.stem);
  console.log('--- options ---');
  question.options.forEach((option, index) => console.log(`${String.fromCharCode(65 + index)}. ${option}`));
  console.log(`--- answer: ${question.answer} ---`);
  console.log('--- analysis ---');
  console.log(question.analysis);
  console.log(`selection: PRIMARY ${authored.primaryNodeId ?? '(none)'}  SECONDARY ${authored.secondaryNodeIds.join(', ') || '(none)'}`);
}

function printSearch(ctx, query, subject) {
  const normalized = String(query ?? '').trim().toLowerCase();
  if (!normalized) throw new Error('search query required');
  if (!VALID_SUBJECTS.includes(subject)) throw new Error(`invalid subject ${subject}; expected one of ${VALID_SUBJECTS.join('/')}`);
  const matches = ctx.nodes
    .filter((node) => node.subject === subject && node.nodeType === 'atomicPoint' && node.isActive)
    .filter((node) =>
      [node.nodeId, node.name, node.chapterName, node.sectionName].some(
        (value) => value != null && String(value).toLowerCase().includes(normalized),
      ),
    )
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    .slice(0, 20);
  if (matches.length === 0) {
    console.log(`no active atomic nodes in ${subject} match "${query}"`);
    return;
  }
  console.log(`${matches.length} match(es) in ${subject}:`);
  for (const node of matches) {
    console.log(`${node.nodeId}\t${node.name}\t${node.chapterName ?? ''}\t${node.sectionName ?? ''}`);
  }
}

function applySet(ctx, questionId, primary, secondary) {
  const frozen = ctx.goldSet.frozen.find((entry) => entry.questionId === questionId);
  if (!frozen) throw new Error(`question ${questionId} is not a frozen gold question`);
  if (!primary) throw new Error('set requires --primary <nodeId>');
  if (new Set(secondary).size !== secondary.length) throw new Error('duplicate SECONDARY node ids');
  if (secondary.includes(primary)) throw new Error('PRIMARY cannot also be SECONDARY');
  for (const nodeId of [primary, ...secondary]) {
    if (!ctx.maps.nodeIds.has(nodeId)) throw new Error(`node ${nodeId} does not exist`);
    if (!ctx.maps.nodeActive.has(nodeId)) throw new Error(`node ${nodeId} is inactive`);
    if (!ctx.maps.nodeAtomic.has(nodeId)) throw new Error(`node ${nodeId} is not an atomic point`);
    if (ctx.maps.nodeSubject.get(nodeId) !== frozen.subject) {
      throw new Error(`node ${nodeId} is not in subject ${frozen.subject}`);
    }
  }
  const entry = {
    questionId,
    contentFingerprint: frozen.contentFingerprint,
    split: frozen.split,
    primaryNodeId: primary,
    secondaryNodeIds: [...secondary],
  };
  const validation = validateGoldEntry(entry, ctx.maps.nodeIds, ctx.maps.byQuestion, ctx.maps.nodeSubject, validationContext(ctx));
  if (!validation.ok) {
    throw new Error(`invalid selection: ${validation.errors.join('; ')}`);
  }
  ctx.goldSet.authoring[questionId] = { status: 'draft', primaryNodeId: primary, secondaryNodeIds: [...secondary] };
  saveGoldSet(ctx.goldSetPath, ctx.goldSet);
  const secondaryText = secondary.length ? `, SECONDARY ${secondary.join(', ')}` : '';
  console.log(`set ${questionId}: PRIMARY ${primary}${secondaryText} (draft; run confirm to lock)`);
}

function applyConfirm(ctx, questionId) {
  const frozen = ctx.goldSet.frozen.find((entry) => entry.questionId === questionId);
  if (!frozen) throw new Error(`question ${questionId} is not a frozen gold question`);
  const authored = ctx.goldSet.authoring[questionId];
  const entry = {
    questionId,
    contentFingerprint: frozen.contentFingerprint,
    split: frozen.split,
    primaryNodeId: authored.primaryNodeId,
    secondaryNodeIds: authored.secondaryNodeIds,
  };
  const validation = validateGoldEntry(entry, ctx.maps.nodeIds, ctx.maps.byQuestion, ctx.maps.nodeSubject, validationContext(ctx));
  if (!validation.ok) {
    throw new Error(`cannot confirm ${questionId}: ${validation.errors.join('; ')}`);
  }
  authored.status = 'confirmed';
  saveGoldSet(ctx.goldSetPath, ctx.goldSet);
  console.log(`confirmed ${questionId}`);
}

function applyReopen(ctx, questionId) {
  const authored = ctx.goldSet.authoring[questionId];
  if (!authored) throw new Error(`question ${questionId} is not a frozen gold question`);
  authored.status = 'draft';
  saveGoldSet(ctx.goldSetPath, ctx.goldSet);
  console.log(`reopened ${questionId} (draft)`);
}

function applyFreeze(ctx, { goldVersion, manifestOut }) {
  const freeze = ctx.config.mode === 'v2-40'
    ? freezeGoldManifestV2Forty
    : (ctx.config.mode === 'v2' ? freezeGoldManifestV2 : freezeGoldManifest);
  const result = freeze({ goldVersion, goldSet: ctx.goldSet, snapshot: ctx.snapshotForFreeze });
  if (!result.ok) {
    throw new Error(`cannot freeze: ${result.errors.join('; ')}`);
  }
  writeFileSync(manifestOut, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  console.log(`frozen Gold Truth manifest written: ${manifestOut}`);
  console.log(`goldVersion: ${goldVersion}`);
  console.log(`sha256: ${result.manifest.sha256}`);
}

function runOneShot(args, ctx) {
  switch (args.command) {
    case 'status':
      printStatus(ctx);
      break;
    case 'list':
      printList(ctx);
      break;
    case 'next': {
      const id = nextUnconfirmed(ctx);
      if (id) showQuestion(ctx, id);
      else console.log(`all ${ctx.config.total} gold questions are confirmed`);
      break;
    }
    case 'show': {
      if (args.positionals.length !== 1) throw new Error('usage: show <questionId>');
      showQuestion(ctx, args.positionals[0]);
      break;
    }
    case 'search-nodes':
    case 'search': {
      if (args.positionals.length !== 1 || !args.flags.subject) {
        throw new Error('usage: search-nodes <query> --subject <code>');
      }
      printSearch(ctx, args.positionals[0], args.flags.subject);
      break;
    }
    case 'set': {
      if (args.positionals.length !== 1) {
        throw new Error('usage: set <questionId> --primary <nodeId> [--secondary <nodeId> ...]');
      }
      applySet(ctx, args.positionals[0], args.flags.primary ?? null, args.flags.secondary ?? []);
      break;
    }
    case 'confirm': {
      if (args.positionals.length !== 1) throw new Error('usage: confirm <questionId>');
      applyConfirm(ctx, args.positionals[0]);
      break;
    }
    case 'reopen': {
      if (args.positionals.length !== 1) throw new Error('usage: reopen <questionId>');
      applyReopen(ctx, args.positionals[0]);
      break;
    }
    case 'freeze':
      applyFreeze(ctx, {
        goldVersion: ctx.config.finalGoldVersion,
        manifestOut: args.flags.manifestOut ?? ctx.config.manifestOut,
      });
      break;
    default:
      throw new Error(`unknown command ${args.command}; run with --help for usage`);
  }
}

async function runInteractive(ctx) {
  const rl = createInterface({ input, output });
  console.log('Gold authoring CLI — type "help" for commands, "exit" to quit.');
  printStatus(ctx);
  rl.setPrompt('gold> ');
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }
    const args = parseArgs(trimmed.split(/\s+/));
    if (args.command === 'help' || args.flags.help) {
      printHelp();
    } else if (args.command === 'exit' || args.command === 'quit') {
      console.log('bye');
      break;
    } else {
      try {
        runOneShot(args, ctx);
      } catch (error) {
        console.error(`error: ${error.message}`);
      }
    }
    rl.prompt();
  }
  rl.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help) {
    printHelp();
    return;
  }
  const config = resolveGoldAuthoringConfig(args.flags);
  const workspacePath = config.workspace;
  const samplePath = config.sample;
  const goldSetPath = config.goldSet;
  const ctx = {
    ...loadContext({ workspacePath, samplePath, splitPath: config.split, mode: config.mode }),
    goldSetPath,
    config,
  };
  ctx.goldSet = loadOrCreateGoldSet({
    goldSetPath,
    sample: ctx.sample,
    snapshotId: ctx.summary.snapshotId,
    mode: config.mode,
  });
  if (!args.command) {
    await runInteractive(ctx);
    return;
  }
  runOneShot(args, ctx);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[gold-author] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
