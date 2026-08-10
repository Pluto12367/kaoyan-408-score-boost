import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical.js';
import {
  V2R2_ACCEPTED_SAMPLE_SHA256,
  V2R2_GOLD_SAMPLE_VERSION,
  buildV2SampleManifest,
} from './sampleV2.js';

export const V2_FORTY_GOLD_SAMPLE_VERSION = 'gold-sample-v2r2-40';
export const V2_FORTY_TOTAL = 40;
export const V2_FORTY_PER_SUBJECT = 10;
export const V2_FORTY_DEV_TOTAL = 32;
export const V2_FORTY_HOLDOUT_TOTAL = 8;
export const V2_FORTY_DEV_PER_SUBJECT = 8;
export const V2_FORTY_HOLDOUT_PER_SUBJECT = 2;
export const V2_FORTY_DIFFICULTY_QUOTA = Object.freeze({ BASIC: 4, MEDIUM: 4, HARD: 2 });
export const V2_FORTY_HOLDOUT_DIFFICULTY = Object.freeze({ BASIC: 3, MEDIUM: 3, HARD: 2 });

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const DIFFICULTIES = ['BASIC', 'MEDIUM', 'HARD'];
const SPLIT_HASH_DOMAIN = 'gold-split-v2r2-40';

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function compareStringArrays(left, right) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const compared = compareStrings(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

function canonicalEntry(entry) {
  return {
    questionId: entry.questionId,
    contentFingerprint: entry.contentFingerprint ?? null,
    subject: entry.subject,
    difficulty: entry.difficulty,
    source: entry.source ?? null,
    year: entry.year ?? null,
    knowledgePointIds: [...(entry.knowledgePointIds ?? [])].sort(compareStrings),
  };
}

function canonicalEntries(entries) {
  return [...(entries ?? [])].map(canonicalEntry).sort((a, b) => compareStrings(a.questionId, b.questionId));
}

function canonicalParentPayload(parentManifest) {
  return buildV2SampleManifest({
    snapshotId: parentManifest?.snapshotId,
    contentSha256: parentManifest?.contentSha256,
    goldVersion: parentManifest?.goldVersion,
    entries: parentManifest?.entries,
  });
}

function validateParentForReduction(parentManifest) {
  if (!parentManifest || typeof parentManifest !== 'object') {
    throw new Error('V2-40 parent manifest missing');
  }
  if (parentManifest.goldVersion !== V2R2_GOLD_SAMPLE_VERSION) {
    throw new Error(`V2-40 requires parent ${V2R2_GOLD_SAMPLE_VERSION}`);
  }
  const canonical = canonicalParentPayload(parentManifest);
  if (canonical.sha256 !== parentManifest.sha256) {
    throw new Error('V2-40 parent manifest sha256 mismatch');
  }
  if (!Array.isArray(parentManifest.entries) || parentManifest.entries.length !== 100) {
    throw new Error(`V2-40 parent must contain 100 entries, got ${parentManifest.entries?.length ?? 'none'}`);
  }
}

function enumerateCompositions(total, availability) {
  const rows = [];
  for (let basic = 0; basic <= Math.min(total, availability.BASIC); basic += 1) {
    for (let medium = 0; medium <= Math.min(total - basic, availability.MEDIUM); medium += 1) {
      const hard = total - basic - medium;
      if (hard < 0 || hard > availability.HARD) continue;
      rows.push({ BASIC: basic, MEDIUM: medium, HARD: hard });
    }
  }
  return rows;
}

function canonicalMatrix(matrix) {
  return Object.keys(matrix).sort(compareStrings).map((kpId) => [
    kpId,
    matrix[kpId].BASIC,
    matrix[kpId].MEDIUM,
    matrix[kpId].HARD,
  ]);
}

function compareCanonicalMatrices(left, right) {
  for (let row = 0; row < left.length; row += 1) {
    const kpCompared = compareStrings(left[row][0], right[row][0]);
    if (kpCompared !== 0) return kpCompared;
    for (let column = 1; column < left[row].length; column += 1) {
      if (left[row][column] !== right[row][column]) return left[row][column] - right[row][column];
    }
  }
  return 0;
}

export function scoreV2FortyMatrix(matrix, parentTotalByKp) {
  const canonical = canonicalMatrix(matrix);
  const hardCounts = canonical.map((row) => row[3]);
  const maxHard = Math.max(...hardCounts);
  const hardRange = maxHard - Math.min(...hardCounts);
  const difficultyDeviationCost = canonical.reduce((sum, [, basic, medium, hard]) => {
    const total = basic + medium + hard;
    return sum
      + (5 * basic - 2 * total) ** 2
      + (5 * medium - 2 * total) ** 2
      + (5 * hard - total) ** 2;
  }, 0);
  const thirdSlotOwners = canonical
    .filter(([, basic, medium, hard]) => basic + medium + hard === 3)
    .map(([kpId]) => ({ kpId, eligible: parentTotalByKp.get(kpId) }))
    .sort((left, right) => right.eligible - left.eligible || compareStrings(left.kpId, right.kpId));
  return { maxHard, hardRange, difficultyDeviationCost, thirdSlotOwners, canonical };
}

export function compareV2FortyMatrixScores(left, right) {
  if (left.maxHard !== right.maxHard) return left.maxHard - right.maxHard;
  if (left.hardRange !== right.hardRange) return left.hardRange - right.hardRange;
  if (left.difficultyDeviationCost !== right.difficultyDeviationCost) {
    return left.difficultyDeviationCost - right.difficultyDeviationCost;
  }
  for (let index = 0; index < left.thirdSlotOwners.length; index += 1) {
    const leftOwner = left.thirdSlotOwners[index];
    const rightOwner = right.thirdSlotOwners[index];
    if (leftOwner.eligible !== rightOwner.eligible) return rightOwner.eligible - leftOwner.eligible;
    const idCompared = compareStrings(leftOwner.kpId, rightOwner.kpId);
    if (idCompared !== 0) return idCompared;
  }
  return compareCanonicalMatrices(left.canonical, right.canonical);
}

function selectSubjectEntries(subject, entries) {
  const subjectEntries = entries.filter((entry) => entry.subject === subject);
  if (subjectEntries.length !== 25) {
    throw new Error(`V2-40 parent subject ${subject} has ${subjectEntries.length} entries, expected 25`);
  }
  const kpIds = [...new Set(subjectEntries.flatMap((entry) => entry.knowledgePointIds ?? []))].sort(compareStrings);
  if (kpIds.length !== 4) {
    throw new Error(`V2-40 parent subject ${subject} has ${kpIds.length} KPs, expected 4`);
  }
  const cells = new Map();
  const parentTotalByKp = new Map(kpIds.map((kpId) => [kpId, 0]));
  for (const kpId of kpIds) {
    for (const difficulty of DIFFICULTIES) cells.set(`${kpId}|${difficulty}`, []);
  }
  for (const entry of subjectEntries) {
    if (!DIFFICULTIES.includes(entry.difficulty)) {
      throw new Error(`V2-40 parent question ${entry.questionId} has invalid difficulty ${entry.difficulty}`);
    }
    if (!Array.isArray(entry.knowledgePointIds) || entry.knowledgePointIds.length !== 1) {
      throw new Error(`V2-40 parent question ${entry.questionId} must have exactly one KP`);
    }
    const kpId = entry.knowledgePointIds[0];
    cells.get(`${kpId}|${entry.difficulty}`).push(canonicalEntry(entry));
    parentTotalByKp.set(kpId, parentTotalByKp.get(kpId) + 1);
  }
  for (const values of cells.values()) values.sort((a, b) => compareStrings(a.questionId, b.questionId));

  let best = null;
  const matrix = {};
  const visit = (kpIndex, owners, remaining) => {
    if (kpIndex === kpIds.length) {
      if (Object.values(remaining).some((value) => value !== 0)) return;
      const candidate = Object.fromEntries(kpIds.map((kpId) => [kpId, { ...matrix[kpId] }]));
      const score = scoreV2FortyMatrix(candidate, parentTotalByKp);
      if (best === null || compareV2FortyMatrixScores(score, best.score) < 0) best = { matrix: candidate, score };
      return;
    }
    const kpId = kpIds[kpIndex];
    for (const isOwner of [false, true]) {
      if (owners + Number(isOwner) > 2) continue;
      const remainingKps = kpIds.length - kpIndex - 1;
      if (owners + Number(isOwner) + remainingKps < 2) continue;
      const rowTotal = isOwner ? 3 : 2;
      const availability = Object.fromEntries(DIFFICULTIES.map((difficulty) => [
        difficulty,
        cells.get(`${kpId}|${difficulty}`).length,
      ]));
      for (const row of enumerateCompositions(rowTotal, availability)) {
        if (DIFFICULTIES.some((difficulty) => row[difficulty] > remaining[difficulty])) continue;
        matrix[kpId] = row;
        visit(kpIndex + 1, owners + Number(isOwner), Object.fromEntries(DIFFICULTIES.map((difficulty) => [
          difficulty,
          remaining[difficulty] - row[difficulty],
        ])));
      }
    }
    delete matrix[kpId];
  };
  visit(0, 0, { ...V2_FORTY_DIFFICULTY_QUOTA });
  if (best === null) throw new Error(`V2-40 SAMPLING BLOCKED: ${subject} has no exact 3/3/2/2 + 4/4/2 matrix`);

  const selected = [];
  for (const kpId of kpIds) {
    for (const difficulty of DIFFICULTIES) {
      selected.push(...cells.get(`${kpId}|${difficulty}`).slice(0, best.matrix[kpId][difficulty]));
    }
  }
  return selected;
}

export function selectV2FortyEntries(parentManifest) {
  validateParentForReduction(parentManifest);
  const selected = SUBJECTS.flatMap((subject) => selectSubjectEntries(subject, parentManifest.entries));
  const ids = new Set(selected.map((entry) => entry.questionId));
  if (selected.length !== V2_FORTY_TOTAL || ids.size !== V2_FORTY_TOTAL) {
    throw new Error(`V2-40 SAMPLING BLOCKED: selected ${selected.length} entries / ${ids.size} unique ids`);
  }
  return selected.sort((a, b) => compareStrings(a.questionId, b.questionId));
}

function buildSamplePayload({ parentManifest, entries }) {
  return {
    goldVersion: V2_FORTY_GOLD_SAMPLE_VERSION,
    snapshotId: parentManifest.snapshotId,
    contentSha256: parentManifest.contentSha256,
    parentSampleSha256: parentManifest.sha256,
    entries: canonicalEntries(entries),
  };
}

export function buildV2FortySampleManifest(
  parentManifest,
  { acceptedParentSha256 = V2R2_ACCEPTED_SAMPLE_SHA256 } = {},
) {
  validateParentForReduction(parentManifest);
  if (parentManifest.sha256 !== acceptedParentSha256) {
    throw new Error(`V2-40 accepted parent SHA ${parentManifest.sha256} != ${acceptedParentSha256}`);
  }
  const payload = buildSamplePayload({ parentManifest, entries: selectV2FortyEntries(parentManifest) });
  return { ...payload, sha256: canonicalJsonHash(payload) };
}

export function validateV2FortySampleManifest(
  manifest,
  parentManifest,
  { acceptedParentSha256 = V2R2_ACCEPTED_SAMPLE_SHA256 } = {},
) {
  const errors = [];
  try {
    validateParentForReduction(parentManifest);
  } catch (error) {
    errors.push(error.message);
    return { ok: false, errors: errors.sort() };
  }
  if (parentManifest.sha256 !== acceptedParentSha256) errors.push('V2-40 accepted parent SHA mismatch');
  if (manifest?.goldVersion !== V2_FORTY_GOLD_SAMPLE_VERSION) errors.push('V2-40 sample version mismatch');
  if (manifest?.snapshotId !== parentManifest.snapshotId) errors.push('V2-40 sample snapshotId mismatch');
  if (manifest?.contentSha256 !== parentManifest.contentSha256) errors.push('V2-40 sample contentSha256 mismatch');
  if (manifest?.parentSampleSha256 !== parentManifest.sha256) errors.push('V2-40 parentSampleSha256 mismatch');
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (!Array.isArray(manifest?.entries)) errors.push('V2-40 sample entries missing');
  if (entries.length !== V2_FORTY_TOTAL) errors.push(`V2-40 sample entries ${entries.length} != 40`);
  for (const entry of entries) {
    for (const forbidden of ['stem', 'options', 'answer', 'analysis', 'split', 'primaryNodeId', 'secondaryNodeIds', 'authoring']) {
      if (entry && typeof entry === 'object' && forbidden in entry) {
        errors.push(`V2-40 sample entry ${entry.questionId ?? '?'} contains forbidden ${forbidden}`);
      }
    }
  }
  const payload = buildSamplePayload({ parentManifest, entries });
  if (manifest?.sha256 !== canonicalJsonHash(payload)) errors.push('V2-40 sample sha256 mismatch');
  try {
    const expected = selectV2FortyEntries(parentManifest);
    const actualCanonical = canonicalEntries(entries);
    if (JSON.stringify(actualCanonical) !== JSON.stringify(expected)) errors.push('V2-40 sample selection drift');
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function validateFortyShape(sampleManifest) {
  if (!sampleManifest || typeof sampleManifest !== 'object') throw new Error('V2-40 sample missing');
  if (sampleManifest.goldVersion !== V2_FORTY_GOLD_SAMPLE_VERSION) throw new Error('V2-40 sample version mismatch');
  const entries = canonicalEntries(sampleManifest.entries);
  if (entries.length !== V2_FORTY_TOTAL) throw new Error(`V2-40 sample entries ${entries.length} != 40`);
  const generic = buildV2SampleManifest({
    snapshotId: sampleManifest.snapshotId,
    contentSha256: sampleManifest.contentSha256,
    goldVersion: sampleManifest.goldVersion,
    entries,
  });
  const payload = sampleManifest.parentSampleSha256
    ? {
        goldVersion: sampleManifest.goldVersion,
        snapshotId: sampleManifest.snapshotId,
        contentSha256: sampleManifest.contentSha256,
        parentSampleSha256: sampleManifest.parentSampleSha256,
        entries,
      }
    : {
        goldVersion: sampleManifest.goldVersion,
        snapshotId: sampleManifest.snapshotId,
        contentSha256: sampleManifest.contentSha256,
        entries,
      };
  const expectedSha = sampleManifest.parentSampleSha256 ? canonicalJsonHash(payload) : generic.sha256;
  if (sampleManifest.sha256 !== expectedSha) throw new Error('V2-40 sample sha256 mismatch');
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.questionId || seen.has(entry.questionId)) throw new Error(`V2-40 invalid or duplicate id ${entry.questionId}`);
    seen.add(entry.questionId);
    if (!SUBJECTS.includes(entry.subject) || !DIFFICULTIES.includes(entry.difficulty)) {
      throw new Error(`V2-40 invalid metadata for ${entry.questionId}`);
    }
    if (entry.knowledgePointIds.length !== 1) throw new Error(`V2-40 question ${entry.questionId} must have exactly one KP`);
  }
  for (const subject of SUBJECTS) {
    if (entries.filter((entry) => entry.subject === subject).length !== V2_FORTY_PER_SUBJECT) {
      throw new Error(`V2-40 subject ${subject} must contain 10 entries`);
    }
  }
  return entries;
}

function validSubjectPairs(entries) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const pair = [entries[leftIndex], entries[rightIndex]].sort((a, b) => compareStrings(a.questionId, b.questionId));
      if (pair[0].difficulty === pair[1].difficulty) continue;
      if (pair[0].knowledgePointIds[0] === pair[1].knowledgePointIds[0]) continue;
      const holdoutIds = new Set(pair.map((entry) => entry.questionId));
      const devKps = new Set(entries.filter((entry) => !holdoutIds.has(entry.questionId)).map((entry) => entry.knowledgePointIds[0]));
      if (devKps.size !== 4) continue;
      pairs.push(pair);
    }
  }
  return pairs;
}

function splitCandidateDigest(sampleSha256, ids) {
  return createHash('sha256')
    .update(`${SPLIT_HASH_DOMAIN}\n${sampleSha256}\n${ids.join('\n')}`, 'utf8')
    .digest('hex');
}

export function splitV2FortyDevHoldout(sampleManifest) {
  const entries = validateFortyShape(sampleManifest);
  const pairsBySubject = new Map(SUBJECTS.map((subject) => [
    subject,
    validSubjectPairs(entries.filter((entry) => entry.subject === subject)),
  ]));
  let best = null;
  const visit = (subjectIndex, selected, counts) => {
    if (subjectIndex === SUBJECTS.length) {
      if (DIFFICULTIES.some((difficulty) => counts[difficulty] !== V2_FORTY_HOLDOUT_DIFFICULTY[difficulty])) return;
      const ids = selected.flat().map((entry) => entry.questionId).sort(compareStrings);
      const digest = splitCandidateDigest(sampleManifest.sha256, ids);
      if (best === null || digest < best.digest || (digest === best.digest && compareStringArrays(ids, best.ids) < 0)) {
        best = { digest, ids };
      }
      return;
    }
    const subject = SUBJECTS[subjectIndex];
    for (const pair of pairsBySubject.get(subject)) {
      const nextCounts = { ...counts };
      for (const entry of pair) nextCounts[entry.difficulty] += 1;
      if (DIFFICULTIES.some((difficulty) => nextCounts[difficulty] > V2_FORTY_HOLDOUT_DIFFICULTY[difficulty])) continue;
      visit(subjectIndex + 1, [...selected, pair], nextCounts);
    }
  };
  visit(0, [], { BASIC: 0, MEDIUM: 0, HARD: 0 });
  if (best === null) throw new Error('V2-40 SPLIT BLOCKED: no exact 32/8 constrained split exists');
  const holdoutSet = new Set(best.ids);
  return {
    dev: entries.map((entry) => entry.questionId).filter((id) => !holdoutSet.has(id)).sort(compareStrings),
    holdout: [...best.ids],
  };
}

function splitPayload({ sampleManifest, split }) {
  return {
    goldVersion: V2_FORTY_GOLD_SAMPLE_VERSION,
    snapshotId: sampleManifest.snapshotId,
    sampleSha256: sampleManifest.sha256,
    split: {
      dev: [...(split?.dev ?? [])].sort(compareStrings),
      holdout: [...(split?.holdout ?? [])].sort(compareStrings),
    },
  };
}

function splitErrors(manifest, sampleManifest) {
  const errors = [];
  let entries;
  try {
    entries = validateFortyShape(sampleManifest);
  } catch (error) {
    return [error.message];
  }
  if (manifest?.goldVersion !== V2_FORTY_GOLD_SAMPLE_VERSION) errors.push('V2-40 split goldVersion mismatch');
  if (manifest?.snapshotId !== sampleManifest.snapshotId) errors.push('V2-40 split snapshotId mismatch');
  if (manifest?.sampleSha256 !== sampleManifest.sha256) errors.push('V2-40 split sampleSha256 mismatch');
  const dev = Array.isArray(manifest?.split?.dev) ? manifest.split.dev : [];
  const holdout = Array.isArray(manifest?.split?.holdout) ? manifest.split.holdout : [];
  if (dev.length !== V2_FORTY_DEV_TOTAL) errors.push(`V2-40 DEV total ${dev.length} != 32`);
  if (holdout.length !== V2_FORTY_HOLDOUT_TOTAL) errors.push(`V2-40 HOLDOUT total ${holdout.length} != 8`);
  const all = [...dev, ...holdout];
  if (all.some((id) => typeof id !== 'string' || id.length === 0)) errors.push('V2-40 split contains invalid id');
  if (new Set(all).size !== V2_FORTY_TOTAL) errors.push('V2-40 split ids must be 40 unique values');
  const sampleIds = entries.map((entry) => entry.questionId).sort(compareStrings);
  if (compareStringArrays([...new Set(all)].sort(compareStrings), sampleIds) !== 0) errors.push('V2-40 split union differs from sample');
  const payload = splitPayload({ sampleManifest, split: { dev, holdout } });
  if (manifest?.sha256 !== canonicalJsonHash(payload)) errors.push('V2-40 split sha256 mismatch');
  try {
    const expected = splitV2FortyDevHoldout(sampleManifest);
    if (compareStringArrays([...dev].sort(compareStrings), expected.dev) !== 0
      || compareStringArrays([...holdout].sort(compareStrings), expected.holdout) !== 0) {
      errors.push('V2-40 split selection drift');
    }
  } catch (error) {
    errors.push(error.message);
  }
  return [...new Set(errors)].sort();
}

export function buildV2FortySplitManifest({ sampleManifest, split }) {
  const raw = splitPayload({ sampleManifest, split });
  const candidate = { ...raw, sha256: canonicalJsonHash(raw) };
  const errors = splitErrors(candidate, sampleManifest);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return candidate;
}

export function validateV2FortySplitManifest(manifest, sampleManifest) {
  const errors = splitErrors(manifest, sampleManifest);
  return { ok: errors.length === 0, errors };
}
