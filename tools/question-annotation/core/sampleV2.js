import { canonicalJsonHash } from './canonical.js';

export const V2_GOLD_SAMPLE_VERSION = 'gold-sample-v2';
export const V2R_GOLD_SAMPLE_VERSION = 'gold-sample-v2r';
export const V2R2_GOLD_SAMPLE_VERSION = 'gold-sample-v2r2';
export const V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256 = '439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc';
export const V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256 = '368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854';
export const V2_TOTAL = 100;
export const V2_PER_SUBJECT = 25;
export const V2_DIFFICULTY_QUOTA = { BASIC: 10, MEDIUM: 10, HARD: 5 };
export const V2_KP_MIN_PER_SUBJECT = 6;
export const V2_KP_MAX_PER_SUBJECT = 7;
const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const DIFFICULTY_ORDER = ['BASIC', 'MEDIUM', 'HARD'];

/**
 * Canonical REQUIRED_V2_KP_SET: knowledge points referenced by at least one
 * eligible (current, INDEPENDENT_UNIT) question. Expected size 16 for the
 * frozen snapshot; the two orphan rows with zero relations are excluded.
 */
export function computeRequiredV2KpSet(snapshot) {
  const eligible = new Set(
    (snapshot.questions ?? [])
      .filter((question) => snapshot.roles?.[question.id] === 'INDEPENDENT_UNIT' && question.isCurrent === true)
      .map((question) => question.id),
  );
  const kpIds = new Set();
  for (const relation of snapshot.questionKnowledgePoints ?? []) {
    if (eligible.has(relation.questionId)) kpIds.add(relation.knowledgePointId);
  }
  return kpIds;
}

/**
 * Eligible V2 pool: current, INDEPENDENT_UNIT, and NOT in the old V1 Gold
 * lineage (questionId, exact fingerprint, or version family).
 */
export function buildV2EligiblePool(snapshot, oldGold) {
  const oldIds = oldGold?.ids ?? new Set();
  const oldFingerprints = oldGold?.fingerprints ?? new Set();
  const oldFamilies = oldGold?.families ?? new Set();
  return (snapshot.questions ?? []).filter((question) => {
    if (question.isCurrent !== true) return false;
    if (snapshot.roles?.[question.id] !== 'INDEPENDENT_UNIT') return false;
    if (oldIds.has(question.id)) return false;
    if (question.contentFingerprint != null && oldFingerprints.has(question.contentFingerprint)) return false;
    if (oldFamilies.has(question.familyId)) return false;
    return true;
  });
}

function diversityCost(candidate, selected) {
  const chapterRepetition = selected.filter((question) => question.chapterName === candidate.chapterName).length;
  const sourceRepetition = selected.filter((question) => question.source === candidate.source).length;
  const yearRepetition = selected.filter((question) => question.year === candidate.year).length;
  return chapterRepetition + sourceRepetition + yearRepetition;
}

function buildKpIndex(snapshot) {
  const kpIdsByQuestion = new Map();
  for (const relation of snapshot.questionKnowledgePoints ?? []) {
    const list = kpIdsByQuestion.get(relation.questionId) ?? new Set();
    list.add(relation.knowledgePointId);
    kpIdsByQuestion.set(relation.questionId, list);
  }
  return kpIdsByQuestion;
}

function compareIdArrays(left, right) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const compared = left[index].localeCompare(right[index]);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

function solveSubjectV2R({ subject, subjectKps, candidates, ownedKpByQuestion }) {
  const cells = new Map();
  for (const kpId of subjectKps) {
    for (const difficulty of DIFFICULTY_ORDER) cells.set(`${kpId}|${difficulty}`, []);
  }
  for (const question of candidates) {
    const kpId = ownedKpByQuestion.get(question.id);
    const key = `${kpId}|${question.difficulty}`;
    if (cells.has(key)) cells.get(key).push(question.id);
  }
  for (const ids of cells.values()) ids.sort((a, b) => a.localeCompare(b));

  let bestIds = null;
  let bestMatrix = null;
  let bestExtraSevenKpId = null;
  const matrix = {};

  const visit = (kpIndex, remaining, extraSevenKpId) => {
    if (kpIndex === subjectKps.length) {
      if (DIFFICULTY_ORDER.some((difficulty) => remaining[difficulty] !== 0)) return;
      const ids = [];
      for (const kpId of subjectKps) {
        for (const difficulty of DIFFICULTY_ORDER) {
          ids.push(...cells.get(`${kpId}|${difficulty}`).slice(0, matrix[kpId][difficulty]));
        }
      }
      ids.sort((a, b) => a.localeCompare(b));
      if (ids.length !== V2_PER_SUBJECT) return;
      if (bestIds === null || compareIdArrays(ids, bestIds) < 0) {
        bestIds = ids;
        bestExtraSevenKpId = extraSevenKpId;
        bestMatrix = Object.fromEntries(
          subjectKps.map((kpId) => [kpId, { ...matrix[kpId] }]),
        );
      }
      return;
    }

    const kpId = subjectKps[kpIndex];
    const quota = kpId === extraSevenKpId ? V2_KP_MAX_PER_SUBJECT : V2_KP_MIN_PER_SUBJECT;
    const available = Object.fromEntries(
      DIFFICULTY_ORDER.map((difficulty) => [difficulty, cells.get(`${kpId}|${difficulty}`).length]),
    );
    for (let basic = 0; basic <= Math.min(quota, remaining.BASIC, available.BASIC); basic += 1) {
      for (let medium = 0; medium <= Math.min(quota - basic, remaining.MEDIUM, available.MEDIUM); medium += 1) {
        const hard = quota - basic - medium;
        if (hard < 0 || hard > remaining.HARD || hard > available.HARD) continue;
        matrix[kpId] = { BASIC: basic, MEDIUM: medium, HARD: hard };
        visit(kpIndex + 1, {
          BASIC: remaining.BASIC - basic,
          MEDIUM: remaining.MEDIUM - medium,
          HARD: remaining.HARD - hard,
        }, extraSevenKpId);
      }
    }
    delete matrix[kpId];
  };

  for (const extraSevenKpId of subjectKps) {
    visit(0, { ...V2_DIFFICULTY_QUOTA }, extraSevenKpId);
  }

  if (bestIds === null) {
    const availability = subjectKps.map((kpId) => {
      const counts = DIFFICULTY_ORDER.map(
        (difficulty) => `${difficulty}=${cells.get(`${kpId}|${difficulty}`).length}`,
      ).join(',');
      return `${kpId}[${counts}]`;
    }).join(' ');
    return {
      ok: false,
      error: `SAMPLING DESIGN BLOCKED: ${subject} has no joint 7/6/6/6 + 10/10/5 allocation; ${availability}`,
    };
  }
  return { ok: true, ids: bestIds, matrix: bestMatrix, extraSevenKpId: bestExtraSevenKpId };
}

function compareCanonicalMatrices(left, right) {
  for (let rowIndex = 0; rowIndex < Math.min(left.length, right.length); rowIndex += 1) {
    const leftRow = left[rowIndex];
    const rightRow = right[rowIndex];
    const kpCompared = leftRow[0].localeCompare(rightRow[0]);
    if (kpCompared !== 0) return kpCompared;
    for (let columnIndex = 1; columnIndex < leftRow.length; columnIndex += 1) {
      if (leftRow[columnIndex] !== rightRow[columnIndex]) {
        return leftRow[columnIndex] - rightRow[columnIndex];
      }
    }
  }
  return left.length - right.length;
}

export function scoreV2R2Matrix(matrix, eligibleTotalByKp) {
  const canonicalMatrix = Object.keys(matrix ?? {})
    .sort((a, b) => a.localeCompare(b))
    .map((kpId) => [
      kpId,
      matrix[kpId].BASIC,
      matrix[kpId].MEDIUM,
      matrix[kpId].HARD,
    ]);
  const extraSevenRows = canonicalMatrix.filter(([, basic, medium, hard]) => basic + medium + hard === 7);
  if (canonicalMatrix.length !== 4 || extraSevenRows.length !== 1) {
    throw new Error('V2R2 matrix must contain four KPs with exactly one seven-question row');
  }
  const hardCounts = canonicalMatrix.map(([, , , hard]) => hard);
  const maxHard = Math.max(...hardCounts);
  const minHard = Math.min(...hardCounts);
  const difficultyDeviationCost = canonicalMatrix.reduce((total, [, basic, medium, hard]) => {
    const kpTotal = basic + medium + hard;
    return total
      + (5 * basic - 2 * kpTotal) ** 2
      + (5 * medium - 2 * kpTotal) ** 2
      + (5 * hard - kpTotal) ** 2;
  }, 0);
  const extraSevenKpId = extraSevenRows[0][0];
  const extraSevenEligible = eligibleTotalByKp.get(extraSevenKpId);
  if (!Number.isInteger(extraSevenEligible) || extraSevenEligible < 0) {
    throw new Error(`V2R2 eligible total missing for ${extraSevenKpId}`);
  }
  return {
    maxHard,
    hardRange: maxHard - minHard,
    difficultyDeviationCost,
    extraSevenEligible,
    extraSevenKpId,
    canonicalMatrix,
  };
}

export function compareV2R2MatrixScores(left, right) {
  if (left.maxHard !== right.maxHard) return left.maxHard - right.maxHard;
  if (left.hardRange !== right.hardRange) return left.hardRange - right.hardRange;
  if (left.difficultyDeviationCost !== right.difficultyDeviationCost) {
    return left.difficultyDeviationCost - right.difficultyDeviationCost;
  }
  if (left.extraSevenEligible !== right.extraSevenEligible) {
    return right.extraSevenEligible - left.extraSevenEligible;
  }
  const extraSevenKpCompared = left.extraSevenKpId.localeCompare(right.extraSevenKpId);
  if (extraSevenKpCompared !== 0) return extraSevenKpCompared;
  return compareCanonicalMatrices(left.canonicalMatrix, right.canonicalMatrix);
}

function enumerateFeasibleAllocationMatrices({ subjectKps, cells, onMatrix }) {
  const matrix = {};
  const visit = (kpIndex, remaining, extraSevenKpId) => {
    if (kpIndex === subjectKps.length) {
      if (DIFFICULTY_ORDER.some((difficulty) => remaining[difficulty] !== 0)) return;
      onMatrix(Object.fromEntries(subjectKps.map((kpId) => [kpId, { ...matrix[kpId] }])));
      return;
    }

    const kpId = subjectKps[kpIndex];
    const quota = kpId === extraSevenKpId ? V2_KP_MAX_PER_SUBJECT : V2_KP_MIN_PER_SUBJECT;
    const available = Object.fromEntries(
      DIFFICULTY_ORDER.map((difficulty) => [difficulty, cells.get(`${kpId}|${difficulty}`).length]),
    );
    for (let basic = 0; basic <= Math.min(quota, remaining.BASIC, available.BASIC); basic += 1) {
      for (let medium = 0; medium <= Math.min(quota - basic, remaining.MEDIUM, available.MEDIUM); medium += 1) {
        const hard = quota - basic - medium;
        if (hard < 0 || hard > remaining.HARD || hard > available.HARD) continue;
        matrix[kpId] = { BASIC: basic, MEDIUM: medium, HARD: hard };
        visit(kpIndex + 1, {
          BASIC: remaining.BASIC - basic,
          MEDIUM: remaining.MEDIUM - medium,
          HARD: remaining.HARD - hard,
        }, extraSevenKpId);
      }
    }
    delete matrix[kpId];
  };

  for (const extraSevenKpId of subjectKps) {
    visit(0, { ...V2_DIFFICULTY_QUOTA }, extraSevenKpId);
  }
}

function solveSubjectV2R2({ subject, subjectKps, candidates, ownedKpByQuestion }) {
  const cells = new Map();
  for (const kpId of subjectKps) {
    for (const difficulty of DIFFICULTY_ORDER) cells.set(`${kpId}|${difficulty}`, []);
  }
  for (const question of candidates) {
    const kpId = ownedKpByQuestion.get(question.id);
    const key = `${kpId}|${question.difficulty}`;
    if (cells.has(key)) cells.get(key).push(question.id);
  }
  for (const ids of cells.values()) ids.sort((a, b) => a.localeCompare(b));

  const eligibleTotalByKp = new Map(subjectKps.map((kpId) => [
    kpId,
    DIFFICULTY_ORDER.reduce(
      (total, difficulty) => total + cells.get(`${kpId}|${difficulty}`).length,
      0,
    ),
  ]));
  let bestMatrix = null;
  let bestScore = null;

  enumerateFeasibleAllocationMatrices({
    subjectKps,
    cells,
    onMatrix: (candidateMatrix) => {
      const candidateScore = scoreV2R2Matrix(candidateMatrix, eligibleTotalByKp);
      if (bestScore === null || compareV2R2MatrixScores(candidateScore, bestScore) < 0) {
        bestMatrix = candidateMatrix;
        bestScore = candidateScore;
      }
    },
  });

  if (bestMatrix === null) {
    const availability = subjectKps.map((kpId) => {
      const counts = DIFFICULTY_ORDER.map(
        (difficulty) => `${difficulty}=${cells.get(`${kpId}|${difficulty}`).length}`,
      ).join(',');
      return `${kpId}[${counts}]`;
    }).join(' ');
    return {
      ok: false,
      error: `SAMPLING DESIGN BLOCKED: ${subject} has no joint 7/6/6/6 + 10/10/5 allocation; ${availability}`,
    };
  }

  // The allocation matrix is frozen before any concrete question is chosen.
  const ids = [];
  for (const kpId of subjectKps) {
    for (const difficulty of DIFFICULTY_ORDER) {
      ids.push(...cells.get(`${kpId}|${difficulty}`).slice(0, bestMatrix[kpId][difficulty]));
    }
  }
  ids.sort((a, b) => a.localeCompare(b));
  return {
    ok: true,
    ids,
    matrix: bestMatrix,
    score: bestScore,
    extraSevenKpId: bestScore.extraSevenKpId,
  };
}

function solveV2R(snapshot, oldGold) {
  const errors = [];
  const rows = [];
  const selections = new Map();
  const pool = buildV2EligiblePool(snapshot, oldGold);
  const required = computeRequiredV2KpSet(snapshot);
  const kpSubject = new Map((snapshot.knowledgePoints ?? []).map((point) => [point.id, point.subject]));
  const kpIdsByQuestion = buildKpIndex(snapshot);
  const ownedKpByQuestion = new Map();

  if (required.size !== 16) {
    errors.push(`SAMPLING DESIGN BLOCKED: required V2 KP set size ${required.size} != 16`);
  }
  for (const question of pool) {
    const owned = [...(kpIdsByQuestion.get(question.id) ?? [])]
      .filter((kpId) => required.has(kpId) && kpSubject.get(kpId) === question.subject)
      .sort();
    if (owned.length !== 1) {
      errors.push(
        `SAMPLING DESIGN BLOCKED: ${question.subject} question ${question.id} has ${owned.length} required KP relations`,
      );
      continue;
    }
    if (!DIFFICULTY_ORDER.includes(question.difficulty)) {
      errors.push(
        `SAMPLING DESIGN BLOCKED: ${question.subject} question ${question.id} has unsupported difficulty ${question.difficulty}`,
      );
      continue;
    }
    ownedKpByQuestion.set(question.id, owned[0]);
  }

  for (const subject of SUBJECTS) {
    const subjectKps = [...required].filter((kpId) => kpSubject.get(kpId) === subject).sort();
    if (subjectKps.length !== 4) {
      errors.push(`SAMPLING DESIGN BLOCKED: ${subject} required KP count ${subjectKps.length} != 4`);
      continue;
    }
    const candidates = pool
      .filter((question) => question.subject === subject && ownedKpByQuestion.has(question.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const kpId of subjectKps) {
      const counts = { BASIC: 0, MEDIUM: 0, HARD: 0 };
      for (const question of candidates) {
        if (ownedKpByQuestion.get(question.id) === kpId) counts[question.difficulty] += 1;
      }
      rows.push({
        subject,
        knowledgePointId: kpId,
        eligible: counts.BASIC + counts.MEDIUM + counts.HARD,
        ...counts,
      });
    }
    const solved = solveSubjectV2R({ subject, subjectKps, candidates, ownedKpByQuestion });
    if (!solved.ok) errors.push(solved.error);
    else selections.set(subject, solved);
  }

  return { feasible: errors.length === 0, rows, errors: errors.sort(), selections, pool, required };
}

function solveV2R2(snapshot, oldGold) {
  const errors = [];
  const rows = [];
  const selections = new Map();
  const pool = buildV2EligiblePool(snapshot, oldGold);
  const required = computeRequiredV2KpSet(snapshot);
  const kpSubject = new Map((snapshot.knowledgePoints ?? []).map((point) => [point.id, point.subject]));
  const kpIdsByQuestion = buildKpIndex(snapshot);
  const ownedKpByQuestion = new Map();

  if (required.size !== 16) {
    errors.push(`SAMPLING DESIGN BLOCKED: required V2 KP set size ${required.size} != 16`);
  }
  for (const question of pool) {
    const owned = [...(kpIdsByQuestion.get(question.id) ?? [])]
      .filter((kpId) => required.has(kpId) && kpSubject.get(kpId) === question.subject)
      .sort();
    if (owned.length !== 1) {
      errors.push(
        `SAMPLING DESIGN BLOCKED: ${question.subject} question ${question.id} has ${owned.length} required KP relations`,
      );
      continue;
    }
    if (!DIFFICULTY_ORDER.includes(question.difficulty)) {
      errors.push(
        `SAMPLING DESIGN BLOCKED: ${question.subject} question ${question.id} has unsupported difficulty ${question.difficulty}`,
      );
      continue;
    }
    ownedKpByQuestion.set(question.id, owned[0]);
  }

  for (const subject of SUBJECTS) {
    const subjectKps = [...required].filter((kpId) => kpSubject.get(kpId) === subject).sort();
    if (subjectKps.length !== 4) {
      errors.push(`SAMPLING DESIGN BLOCKED: ${subject} required KP count ${subjectKps.length} != 4`);
      continue;
    }
    const candidates = pool
      .filter((question) => question.subject === subject && ownedKpByQuestion.has(question.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const kpId of subjectKps) {
      const counts = { BASIC: 0, MEDIUM: 0, HARD: 0 };
      for (const question of candidates) {
        if (ownedKpByQuestion.get(question.id) === kpId) counts[question.difficulty] += 1;
      }
      rows.push({
        subject,
        knowledgePointId: kpId,
        eligible: counts.BASIC + counts.MEDIUM + counts.HARD,
        ...counts,
      });
    }
    const solved = solveSubjectV2R2({ subject, subjectKps, candidates, ownedKpByQuestion });
    if (!solved.ok) errors.push(solved.error);
    else selections.set(subject, solved);
  }

  return { feasible: errors.length === 0, rows, errors: errors.sort(), selections, pool, required };
}

export function auditV2RSamplingFeasibility(snapshot, oldGold) {
  const solved = solveV2R(snapshot, oldGold);
  return { feasible: solved.feasible, rows: solved.rows, errors: solved.errors };
}

export function sampleV2RQuestionIds(snapshot, oldGold) {
  const solved = solveV2R(snapshot, oldGold);
  if (!solved.feasible) throw new Error(solved.errors.join('\n'));
  return SUBJECTS.flatMap((subject) => solved.selections.get(subject).ids)
    .sort((a, b) => a.localeCompare(b));
}

export function auditV2R2SamplingFeasibility(snapshot, oldGold) {
  const solved = solveV2R2(snapshot, oldGold);
  return {
    feasible: solved.feasible,
    rows: solved.rows,
    errors: solved.errors,
    subjects: Object.fromEntries(
      SUBJECTS.filter((subject) => solved.selections.has(subject)).map((subject) => {
        const selection = solved.selections.get(subject);
        return [subject, {
          matrix: selection.matrix,
          score: selection.score,
          extraSevenKpId: selection.extraSevenKpId,
        }];
      }),
    ),
  };
}

export function sampleV2R2QuestionIds(snapshot, oldGold) {
  const solved = solveV2R2(snapshot, oldGold);
  if (!solved.feasible) throw new Error(solved.errors.join('\n'));
  return SUBJECTS.flatMap((subject) => solved.selections.get(subject).ids)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Deterministic stratified V2 sampling:
 * 1) eligible pool (current independent, V1-lineage excluded)
 * 2) REQUIRED_V2_KP_SET computed programmatically; size != 16 or a required KP
 *    with no selectable question -> fail closed
 * 3) per subject: Phase A reserves one question per required KP (kpId ASC,
 *    then questionId ASC, skip picked); Phase B fills exact difficulty quotas
 *    10 BASIC / 10 MEDIUM / 5 HARD in fixed bucket order with the deterministic
 *    diversity objective (chapter/source/year repetition, then questionId ASC)
 * 4) final list sorted by questionId ASC; no randomness, input-order independent
 */
export function sampleV2QuestionIds(snapshot, oldGold) {
  const pool = buildV2EligiblePool(snapshot, oldGold);
  const required = computeRequiredV2KpSet(snapshot);
  if (required.size !== 16) {
    throw new Error(`V2 sampling blocked: required V2 KP set size ${required.size} != 16`);
  }
  const kpSubject = new Map((snapshot.knowledgePoints ?? []).map((point) => [point.id, point.subject]));
  const kpIdsByQuestion = buildKpIndex(snapshot);
  const selected = [];

  for (const subject of SUBJECTS) {
    const candidates = pool.filter((question) => question.subject === subject).sort((a, b) => a.id.localeCompare(b.id));
    const subjectKps = [...required].filter((kpId) => kpSubject.get(kpId) === subject).sort();
    const picked = new Set();
    const subjectSelected = [];
    const pick = (question) => {
      if (!picked.has(question.id)) {
        picked.add(question.id);
        subjectSelected.push(question);
      }
    };

    for (const kpId of subjectKps) {
      const candidate = candidates.find((question) => !picked.has(question.id) && kpIdsByQuestion.get(question.id)?.has(kpId));
      if (!candidate) {
        throw new Error(`V2 sampling blocked: required KP ${kpId} (${subject}) has no selectable question after V1 exclusion`);
      }
      pick(candidate);
    }

    const remainingQuota = { ...V2_DIFFICULTY_QUOTA };
    for (const question of subjectSelected) {
      if (!DIFFICULTY_ORDER.includes(question.difficulty)) {
        throw new Error(`V2 sampling blocked: ${subject} question ${question.id} has unsupported difficulty ${question.difficulty}`);
      }
      remainingQuota[question.difficulty] -= 1;
    }
    for (const difficulty of DIFFICULTY_ORDER) {
      const need = remainingQuota[difficulty];
      if (need < 0) {
        throw new Error(`V2 sampling blocked: ${subject} difficulty ${difficulty} overfilled`);
      }
      const available = candidates.filter((question) => !picked.has(question.id) && question.difficulty === difficulty);
      if (available.length < need) {
        throw new Error(
          `V2 sampling blocked: ${subject} difficulty ${difficulty} shortage required=${need} available=${available.length}`,
        );
      }
      for (let index = 0; index < need; index += 1) {
        const best = available
          .filter((question) => !picked.has(question.id))
          .sort(
            (a, b) =>
              diversityCost(a, subjectSelected) - diversityCost(b, subjectSelected) ||
              a.id.localeCompare(b.id),
          )[0];
        pick(best);
      }
    }

    if (subjectSelected.length !== V2_PER_SUBJECT) {
      throw new Error(`V2 sampling blocked: ${subject} selected ${subjectSelected.length} != ${V2_PER_SUBJECT}`);
    }
    const covered = new Set();
    for (const question of subjectSelected) {
      for (const kpId of kpIdsByQuestion.get(question.id) ?? []) covered.add(kpId);
    }
    for (const kpId of subjectKps) {
      if (!covered.has(kpId)) {
        throw new Error(`V2 sampling blocked: ${subject} required KP ${kpId} not covered by the final sample`);
      }
    }
    selected.push(...subjectSelected);
  }
  return selected.map((question) => question.id).sort((a, b) => a.localeCompare(b));
}

/**
 * Git-safe V2 sample manifest: identity + fingerprints + subject/difficulty/
 * source/year + KP audit ids. No stem/options/answer/analysis, no split.
 * SHA over the canonical (questionId-sorted) payload via the shared utility.
 */
export function buildV2SampleManifest({ snapshotId, contentSha256, goldVersion = V2_GOLD_SAMPLE_VERSION, entries }) {
  const sorted = [...(entries ?? [])]
    .map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint ?? null,
      subject: entry.subject,
      difficulty: entry.difficulty,
      source: entry.source ?? null,
      year: entry.year ?? null,
      knowledgePointIds: [...(entry.knowledgePointIds ?? [])].sort(),
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  const payload = { goldVersion, snapshotId, contentSha256, entries: sorted };
  return { ...payload, sha256: canonicalJsonHash(payload) };
}

export function buildV2RSampleManifest({ snapshotId, contentSha256, entries }) {
  return buildV2SampleManifest({
    snapshotId,
    contentSha256,
    goldVersion: V2R_GOLD_SAMPLE_VERSION,
    entries,
  });
}

export function buildV2R2SampleManifest({ snapshotId, contentSha256, entries }) {
  return buildV2SampleManifest({
    snapshotId,
    contentSha256,
    goldVersion: V2R2_GOLD_SAMPLE_VERSION,
    entries,
  });
}

/**
 * Fail-closed validation of the V2 sample manifest against the snapshot and
 * (optionally) the old V1 Gold lineage. Errors are sorted.
 */
export function validateV2SampleManifest(manifest, snapshot, oldGold = null) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['sample manifest missing'] };
  }
  if (manifest.goldVersion !== V2_GOLD_SAMPLE_VERSION) {
    errors.push(`manifest: goldVersion ${manifest.goldVersion} != ${V2_GOLD_SAMPLE_VERSION}`);
  }
  if (manifest.snapshotId !== snapshot.snapshotId) {
    errors.push(`manifest: snapshotId ${manifest.snapshotId} != ${snapshot.snapshotId}`);
  }
  if (manifest.contentSha256 !== snapshot.contentSha256) {
    errors.push('manifest: contentSha256 mismatch');
  }
  const entries = manifest.entries ?? [];
  if (!Array.isArray(entries)) {
    errors.push('manifest: entries missing');
  }
  const recomputed = buildV2SampleManifest({
    snapshotId: manifest.snapshotId,
    contentSha256: manifest.contentSha256,
    goldVersion: manifest.goldVersion,
    entries,
  });
  if (manifest.sha256 !== recomputed.sha256) {
    errors.push('manifest: sha256 mismatch');
  }
  if (entries.length !== V2_TOTAL) {
    errors.push(`manifest: entries ${entries.length} != ${V2_TOTAL}`);
  }

  const questionById = new Map((snapshot.questions ?? []).map((question) => [question.id, question]));
  const kpIdsByQuestion = buildKpIndex(snapshot);
  const seen = new Set();
  const perSubject = {};
  const difficultyPerSubject = {};
  const globalDifficulty = { BASIC: 0, MEDIUM: 0, HARD: 0 };
  const coveredKps = new Set();
  for (const entry of entries) {
    if (seen.has(entry.questionId)) {
      errors.push(`manifest: duplicate question ${entry.questionId}`);
    }
    seen.add(entry.questionId);
    const question = questionById.get(entry.questionId);
    if (!question) {
      errors.push(`manifest: unknown question ${entry.questionId}`);
      continue;
    }
    if (question.isCurrent !== true || snapshot.roles?.[question.id] !== 'INDEPENDENT_UNIT') {
      errors.push(`manifest: question ${entry.questionId} not eligible (current independent)`);
    }
    if (question.contentFingerprint !== entry.contentFingerprint) {
      errors.push(`manifest: fingerprint drift for ${entry.questionId}`);
    }
    if (oldGold) {
      if (oldGold.ids?.has(entry.questionId)) errors.push(`manifest: old gold id overlap ${entry.questionId}`);
      if (oldGold.fingerprints?.has(question.contentFingerprint)) {
        errors.push(`manifest: old gold fingerprint overlap ${entry.questionId}`);
      }
      if (oldGold.families?.has(question.familyId)) {
        errors.push(`manifest: old gold version-family overlap ${entry.questionId}`);
      }
    }
    perSubject[question.subject] = (perSubject[question.subject] ?? 0) + 1;
    difficultyPerSubject[question.subject] ??= { BASIC: 0, MEDIUM: 0, HARD: 0 };
    difficultyPerSubject[question.subject][question.difficulty] = (difficultyPerSubject[question.subject][question.difficulty] ?? 0) + 1;
    globalDifficulty[question.difficulty] = (globalDifficulty[question.difficulty] ?? 0) + 1;
    for (const kpId of kpIdsByQuestion.get(question.id) ?? []) coveredKps.add(kpId);
  }

  for (const subject of SUBJECTS) {
    if ((perSubject[subject] ?? 0) !== V2_PER_SUBJECT) {
      errors.push(`manifest: subject ${subject} has ${perSubject[subject] ?? 0} questions, expected ${V2_PER_SUBJECT}`);
    }
    const difficulty = difficultyPerSubject[subject] ?? {};
    for (const [level, quota] of Object.entries(V2_DIFFICULTY_QUOTA)) {
      if ((difficulty[level] ?? 0) !== quota) {
        errors.push(`manifest: subject ${subject} ${level} ${difficulty[level] ?? 0} != ${quota}`);
      }
    }
  }
  const required = computeRequiredV2KpSet(snapshot);
  if (required.size !== 16) errors.push(`manifest: required V2 KP set size ${required.size} != 16`);
  for (const kpId of required) {
    if (!coveredKps.has(kpId)) errors.push(`manifest: required KP ${kpId} not covered`);
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

export function validateV2RSampleManifest(manifest, snapshot, oldGold = null) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['sample manifest missing'] };
  }
  if (
    manifest.goldVersion === V2_GOLD_SAMPLE_VERSION ||
    manifest.sha256 === V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256
  ) {
    errors.push('manifest: REJECTED_PRE_SPLIT_SAMPLE is forbidden');
  }
  if (manifest.goldVersion !== V2R_GOLD_SAMPLE_VERSION) {
    errors.push(`manifest: goldVersion ${manifest.goldVersion} != ${V2R_GOLD_SAMPLE_VERSION}`);
  }
  if (manifest.snapshotId !== snapshot.snapshotId) {
    errors.push(`manifest: snapshotId ${manifest.snapshotId} != ${snapshot.snapshotId}`);
  }
  if (manifest.contentSha256 !== snapshot.contentSha256) {
    errors.push('manifest: contentSha256 mismatch');
  }
  if ('split' in manifest) errors.push('manifest: split is forbidden before V2-2');

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  if (!Array.isArray(manifest.entries)) errors.push('manifest: entries missing');
  const recomputed = buildV2SampleManifest({
    snapshotId: manifest.snapshotId,
    contentSha256: manifest.contentSha256,
    goldVersion: manifest.goldVersion,
    entries,
  });
  if (manifest.sha256 !== recomputed.sha256) errors.push('manifest: sha256 mismatch');
  if (entries.length !== V2_TOTAL) errors.push(`manifest: entries ${entries.length} != ${V2_TOTAL}`);

  const questionById = new Map((snapshot.questions ?? []).map((question) => [question.id, question]));
  const kpIdsByQuestion = buildKpIndex(snapshot);
  const kpSubject = new Map((snapshot.knowledgePoints ?? []).map((point) => [point.id, point.subject]));
  const required = computeRequiredV2KpSet(snapshot);
  const seen = new Set();
  const perSubject = {};
  const difficultyPerSubject = {};
  const kpCountPerSubject = {};

  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      for (const forbidden of ['stem', 'options', 'answer', 'analysis', 'split']) {
        if (forbidden in entry) errors.push(`manifest: entry ${entry.questionId ?? 'unknown'} contains forbidden ${forbidden}`);
      }
    }
    if (seen.has(entry.questionId)) errors.push(`manifest: duplicate question ${entry.questionId}`);
    seen.add(entry.questionId);
    const question = questionById.get(entry.questionId);
    if (!question) {
      errors.push(`manifest: unknown question ${entry.questionId}`);
      continue;
    }
    if (question.isCurrent !== true || snapshot.roles?.[question.id] !== 'INDEPENDENT_UNIT') {
      errors.push(`manifest: question ${entry.questionId} not eligible (current independent)`);
    }
    if (question.contentFingerprint !== entry.contentFingerprint) {
      errors.push(`manifest: fingerprint drift for ${entry.questionId}`);
    }
    if (oldGold) {
      if (oldGold.ids?.has(entry.questionId)) errors.push(`manifest: old gold id overlap ${entry.questionId}`);
      if (oldGold.fingerprints?.has(question.contentFingerprint)) {
        errors.push(`manifest: old gold fingerprint overlap ${entry.questionId}`);
      }
      if (oldGold.families?.has(question.familyId)) {
        errors.push(`manifest: old gold version-family overlap ${entry.questionId}`);
      }
    }
    const owned = [...(kpIdsByQuestion.get(question.id) ?? [])]
      .filter((kpId) => required.has(kpId) && kpSubject.get(kpId) === question.subject)
      .sort();
    if (owned.length !== 1) {
      errors.push(`manifest: question ${entry.questionId} has ${owned.length} required KP relations`);
      continue;
    }
    const manifestKps = [...(entry.knowledgePointIds ?? [])].sort();
    if (manifestKps.length !== 1 || manifestKps[0] !== owned[0]) {
      errors.push(`manifest: knowledgePointIds drift for ${entry.questionId}`);
    }
    perSubject[question.subject] = (perSubject[question.subject] ?? 0) + 1;
    difficultyPerSubject[question.subject] ??= { BASIC: 0, MEDIUM: 0, HARD: 0 };
    difficultyPerSubject[question.subject][question.difficulty] =
      (difficultyPerSubject[question.subject][question.difficulty] ?? 0) + 1;
    kpCountPerSubject[question.subject] ??= {};
    kpCountPerSubject[question.subject][owned[0]] = (kpCountPerSubject[question.subject][owned[0]] ?? 0) + 1;
  }

  if (required.size !== 16) errors.push(`manifest: required V2 KP set size ${required.size} != 16`);
  for (const subject of SUBJECTS) {
    if ((perSubject[subject] ?? 0) !== V2_PER_SUBJECT) {
      errors.push(`manifest: subject ${subject} has ${perSubject[subject] ?? 0} questions, expected ${V2_PER_SUBJECT}`);
    }
    for (const [difficulty, quota] of Object.entries(V2_DIFFICULTY_QUOTA)) {
      const actual = difficultyPerSubject[subject]?.[difficulty] ?? 0;
      if (actual !== quota) errors.push(`manifest: subject ${subject} ${difficulty} ${actual} != ${quota}`);
    }
    const subjectKps = [...required].filter((kpId) => kpSubject.get(kpId) === subject).sort();
    const counts = subjectKps.map((kpId) => kpCountPerSubject[subject]?.[kpId] ?? 0).sort((a, b) => a - b);
    if (JSON.stringify(counts) !== JSON.stringify([6, 6, 6, 7])) {
      errors.push(`manifest: subject ${subject} KP counts ${counts.join('/')} != 6/6/6/7`);
    }
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

export function validateV2R2SampleManifest(manifest, snapshot, oldGold = null) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['sample manifest missing'] };
  }
  const errors = [];
  if (
    manifest.goldVersion === V2_GOLD_SAMPLE_VERSION
    || manifest.goldVersion === V2R_GOLD_SAMPLE_VERSION
    || manifest.sha256 === V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256
    || manifest.sha256 === V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256
  ) {
    errors.push('manifest: REJECTED_PRE_SPLIT_SAMPLE is forbidden');
  }
  if (manifest.goldVersion !== V2R2_GOLD_SAMPLE_VERSION) {
    errors.push(`manifest: goldVersion ${manifest.goldVersion} != ${V2R2_GOLD_SAMPLE_VERSION}`);
  }

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const recomputed = buildV2SampleManifest({
    snapshotId: manifest.snapshotId,
    contentSha256: manifest.contentSha256,
    goldVersion: manifest.goldVersion,
    entries,
  });
  if (manifest.sha256 !== recomputed.sha256) errors.push('manifest: sha256 mismatch');

  // Reuse the already locked balanced-KP structural and lineage validation
  // without changing the historical V2R public contract.
  const v2rProxy = {
    ...manifest,
    goldVersion: V2R_GOLD_SAMPLE_VERSION,
    sha256: buildV2SampleManifest({
      snapshotId: manifest.snapshotId,
      contentSha256: manifest.contentSha256,
      goldVersion: V2R_GOLD_SAMPLE_VERSION,
      entries,
    }).sha256,
  };
  errors.push(...validateV2RSampleManifest(v2rProxy, snapshot, oldGold).errors);

  try {
    const canonicalIds = sampleV2R2QuestionIds(snapshot, oldGold);
    const manifestIds = entries.map((entry) => entry.questionId).sort((a, b) => a.localeCompare(b));
    if (compareIdArrays(manifestIds, canonicalIds) !== 0) {
      errors.push('manifest: entries differ from canonical V2R2 selection');
    }
  } catch (error) {
    errors.push(`manifest: canonical V2R2 selection unavailable: ${error.message}`);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)].sort() };
}
