import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import {
  createGoldSet,
  freezeGoldManifest,
  loadGoldSet,
  saveGoldSet,
  validateGoldEntry,
} from '../core/gold.js';
import {
  getWorkspaceSummary,
  listNodes,
  listQuestions,
  openWorkspace,
  validateWorkspace,
} from '../workspace/workspace.mjs';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  workspace: join(TOOL_ROOT, 'local-data', 'annotation-workspace.db'),
  sample: join(TOOL_ROOT, 'local-data', 'gold-sample-v1.json'),
  goldSet: join(TOOL_ROOT, 'local-data', 'gold-set-v1.json'),
  manifestOut: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
};
const DEFAULT_GOLD_VERSION = 'gold-truth-v1';
const VALID_SUBJECTS = ['DS', 'CO', 'OS', 'CN'];

function printHelp() {
  console.log(`usage: node tools/question-annotation/scripts/gold-author.mjs <command> [options]

commands:
  status                              show authoring progress
  list                                list the 40 frozen gold questions (id/subject/split/status)
  next                                show the next unconfirmed question (content shown locally)
  show <questionId>                   show a question and its current selection
  search-nodes <query> --subject <code>   search active atomic nodes of one subject (DS/CO/OS/CN)
  set <questionId> --primary <nodeId> [--secondary <nodeId> ...]
  confirm <questionId>                lock a valid selection as human-confirmed
  reopen <questionId>                 move a confirmed question back to draft
  freeze                              write the final frozen Gold Truth manifest (only at 40/40)
  exit | quit                         leave the interactive session

options:
  --workspace <path>    annotation workspace db (default: local-data/annotation-workspace.db)
  --sample <path>       frozen Task 4 gold sample json (default: local-data/gold-sample-v1.json)
  --gold-set <path>     authoring state json (default: local-data/gold-set-v1.json)
  --manifest-out <path> final manifest output (default: local-data/gold-truth-manifest-v1.json)
  --gold-version <v>    goldVersion for the final manifest (default: gold-truth-v1)

Run without a command to start the interactive session.`);
}

function parseArgs(argv) {
  const args = { command: null, positionals: [], flags: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') args.flags.workspace = argv[++index];
    else if (token === '--sample') args.flags.sample = argv[++index];
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

function loadContext({ workspacePath, samplePath }) {
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
  const sampleEntries = sample.entries ?? [];
  if (sampleEntries.length !== 40) {
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
  return { summary, questions, nodes, sample, maps, questionById, snapshotForFreeze };
}

function loadOrCreateGoldSet({ goldSetPath, sample, snapshotId }) {
  const frozen = sample.entries.map((entry) => ({
    questionId: entry.questionId,
    contentFingerprint: entry.contentFingerprint,
    subject: entry.subject,
    split: entry.split,
  }));
  const frozenManifestSha256 = sample.manifestSha256;
  let goldSet = loadGoldSet(goldSetPath);
  if (!goldSet) {
    goldSet = createGoldSet({ snapshotId, frozen, frozenManifestSha256 });
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

function printStatus(ctx) {
  const authoring = Object.values(ctx.goldSet.authoring);
  const confirmed = authoring.filter((entry) => entry.status === 'confirmed').length;
  const draft = authoring.filter((entry) => entry.status === 'draft').length;
  const unstarted = 40 - confirmed - draft;
  console.log(`gold set: ${ctx.goldSet.snapshotId} (frozen manifest ${ctx.goldSet.frozenManifestSha256.slice(0, 12)}...)`);
  console.log(`progress: ${confirmed}/40 confirmed, ${draft} draft, ${unstarted} unstarted`);
  const nextId = nextUnconfirmed(ctx);
  console.log(`next unconfirmed: ${nextId ?? '(all 40 confirmed)'}`);
}

function printList(ctx) {
  for (const entry of ctx.goldSet.frozen) {
    const authored = ctx.goldSet.authoring[entry.questionId];
    console.log(`${entry.questionId}\t${entry.subject}\t${entry.split}\t${authored.status}`);
  }
}

function showQuestion(ctx, questionId) {
  const question = ctx.questionById.get(questionId);
  if (!question) throw new Error(`unknown question ${questionId}`);
  const authored = ctx.goldSet.authoring[questionId];
  if (!authored) throw new Error(`question ${questionId} is not a frozen gold question`);
  const frozen = ctx.goldSet.frozen.find((entry) => entry.questionId === questionId);
  console.log(`question: ${questionId}  subject: ${question.subject}  split: ${frozen.split}  status: ${authored.status}`);
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
  const result = freezeGoldManifest({ goldVersion, goldSet: ctx.goldSet, snapshot: ctx.snapshotForFreeze });
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
      else console.log('all 40 gold questions are confirmed');
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
        goldVersion: args.flags.goldVersion ?? DEFAULT_GOLD_VERSION,
        manifestOut: args.flags.manifestOut ?? DEFAULTS.manifestOut,
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
  const workspacePath = args.flags.workspace ?? DEFAULTS.workspace;
  const samplePath = args.flags.sample ?? DEFAULTS.sample;
  const goldSetPath = args.flags.goldSet ?? DEFAULTS.goldSet;
  const ctx = {
    ...loadContext({ workspacePath, samplePath }),
    goldSetPath,
  };
  ctx.goldSet = loadOrCreateGoldSet({ goldSetPath, sample: ctx.sample, snapshotId: ctx.summary.snapshotId });
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
