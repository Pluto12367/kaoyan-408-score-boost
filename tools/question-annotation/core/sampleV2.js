import { canonicalJsonHash } from './canonical.js';

export const V2_GOLD_SAMPLE_VERSION = 'gold-sample-v2';
export const V2_TOTAL = 100;
export const V2_PER_SUBJECT = 25;
export const V2_DIFFICULTY_QUOTA = { BASIC: 10, MEDIUM: 10, HARD: 5 };
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
