import { createHash } from 'node:crypto';

export const GOLD_SAMPLE_VERSION = 'gold-sample-v1';
export const GOLD_PER_SUBJECT = 10;
export const GOLD_TOTAL = 40;
export const DEV_TOTAL = 24;
export const HOLDOUT_TOTAL = 16;
export const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
export const HOLDOUT_INDICES = [1, 4, 7, 9];

function sortedQuestionIds(questions) {
  return [...questions].map((question) => question.id).sort((a, b) => a.localeCompare(b));
}

/**
 * Deterministic per-subject Gold sampling from an AnnotationSnapshot.
 *
 * Contract:
 * - Only annotationRole === 'INDEPENDENT_UNIT' questions are eligible.
 * - Each subject must have at least GOLD_PER_SUBJECT (10) eligible questions,
 *   otherwise sampling throws (fail closed; never borrows across subjects).
 * - Referenced knowledge points are computed from the snapshot data itself;
 *   no production KP ids are hardcoded.
 * - Phase 1 (coverage): for every referenced KP of the subject, pick the first
 *   eligible question (by questionId) linked to that KP. This guarantees all
 *   referenced KPs (including high-impact, broad and previous chapter-mismatch
 *   KPs that exist in the data) are represented.
 * - Phase 2 (fill): iterate KPs in kpId order and pick remaining linked
 *   questions, choosing the one with the lowest marginal difficulty/source/year
 *   repetition against already-selected questions (soft diversity), tie-broken
 *   by questionId ascending. If a subject still has space after every KP-linked
 *   question is exhausted, remaining eligible questions fill the quota in
 *   questionId order.
 * - The returned 40 ids are sorted by (subject, questionId), so the result is
 *   independent of input array ordering and of any DB/rowid ordering.
 *
 * Never mutates the input snapshot.
 */
export function sampleGoldQuestionIds(snapshot) {
  const roles = snapshot.roles ?? {};
  const questionsBySubject = new Map();
  const kpSubject = new Map((snapshot.knowledgePoints ?? []).map((point) => [point.id, point.subject]));
  const kpIdsByQuestion = new Map();

  for (const question of snapshot.questions ?? []) {
    if (roles[question.id] !== 'INDEPENDENT_UNIT') continue;
    const list = questionsBySubject.get(question.subject) ?? [];
    list.push(question);
    questionsBySubject.set(question.subject, list);
  }
  for (const relation of snapshot.questionKnowledgePoints ?? []) {
    const question = (snapshot.questions ?? []).find((item) => item.id === relation.questionId);
    if (!question || roles[question.id] !== 'INDEPENDENT_UNIT') continue;
    if (kpSubject.get(relation.knowledgePointId) !== question.subject) continue;
    const kpIds = kpIdsByQuestion.get(question.id) ?? new Set();
    kpIds.add(relation.knowledgePointId);
    kpIdsByQuestion.set(question.id, kpIds);
  }

  const selected = [];
  for (const subject of SUBJECTS) {
    const eligible = [...(questionsBySubject.get(subject) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    if (eligible.length < GOLD_PER_SUBJECT) {
      throw new Error(
        `sampling failed: subject ${subject} has ${eligible.length} INDEPENDENT_UNIT questions, need ${GOLD_PER_SUBJECT}`,
      );
    }
    const subjectKpIds = [...new Set(eligible.flatMap((question) => [...(kpIdsByQuestion.get(question.id) ?? [])]))].sort();

    const picked = new Set();
    const subjectSelected = [];
    const push = (question) => {
      if (picked.has(question.id)) return;
      picked.add(question.id);
      subjectSelected.push(question);
    };

    // Phase 1: cover every referenced KP with its first eligible question.
    for (const kpId of subjectKpIds) {
      const candidate = eligible.find((question) => !picked.has(question.id) && kpIdsByQuestion.get(question.id)?.has(kpId));
      if (candidate) push(candidate);
    }

    // Phase 2: deterministic diversity-aware fill across KPs.
    while (subjectSelected.length < GOLD_PER_SUBJECT) {
      let best = null;
      let bestKey = null;
      for (const kpId of subjectKpIds) {
        for (const question of eligible) {
          if (picked.has(question.id) || !kpIdsByQuestion.get(question.id)?.has(kpId)) continue;
          const diversityKey = {
            difficulty: subjectSelected.filter((item) => item.difficulty === question.difficulty).length,
            source: subjectSelected.filter((item) => item.source === question.source).length,
            year: subjectSelected.filter((item) => item.year === question.year).length,
          };
          const cost = diversityKey.difficulty + diversityKey.source + diversityKey.year;
          const key = `${String(cost).padStart(3, '0')}|${question.id}`;
          if (bestKey === null || key < bestKey) {
            best = question;
            bestKey = key;
          }
        }
      }
      if (best) {
        push(best);
        continue;
      }
      for (const question of eligible) {
        if (subjectSelected.length >= GOLD_PER_SUBJECT) break;
        if (picked.has(question.id)) continue;
        push(question);
      }
    }

    selected.push(...subjectSelected);
  }

  const subjectById = new Map((snapshot.questions ?? []).map((question) => [question.id, question.subject]));
  return selected
    .map((question) => question.id)
    .sort((a, b) => subjectById.get(a).localeCompare(subjectById.get(b)) || a.localeCompare(b));
}

/**
 * Deterministic Dev/Holdout freeze over the 40 ids returned by
 * sampleGoldQuestionIds. The input is four contiguous subject blocks of 10
 * (subject, questionId sorted); within each block the fixed HOLDOUT_INDICES
 * [1, 4, 7, 9] become HOLDOUT (4 per subject, 16 total) and the rest become
 * DEV (6 per subject, 24 total). Holdout is frozen and must never be used for
 * tuning. The feasibility-class ordering described in the plan is not
 * available through this locked signature (the snapshot/workspace do not carry
 * feasibility audit data), so the deterministic per-subject questionId order
 * is used as the stable stand-in.
 */
export function splitDevHoldout(goldQuestionIds) {
  if (!Array.isArray(goldQuestionIds) || goldQuestionIds.length !== GOLD_TOTAL) {
    throw new Error(`splitDevHoldout expects exactly ${GOLD_TOTAL} gold question ids, got ${goldQuestionIds?.length ?? 'none'}`);
  }
  const dev = [];
  const holdout = [];
  for (let block = 0; block < 4; block += 1) {
    const slice = goldQuestionIds.slice(block * GOLD_PER_SUBJECT, block * GOLD_PER_SUBJECT + GOLD_PER_SUBJECT);
    for (let index = 0; index < slice.length; index += 1) {
      if (HOLDOUT_INDICES.includes(index)) holdout.push(slice[index]);
      else dev.push(slice[index]);
    }
  }
  return { dev, holdout };
}

function canonicalManifestPayload(goldVersion, snapshotId, entries) {
  const sortedEntries = [...entries]
    .map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint ?? null,
      primaryNodeId: entry.primaryNodeId ?? null,
      secondaryNodeIds: [...(entry.secondaryNodeIds ?? [])].sort(),
      ...(entry.split === 'DEV' || entry.split === 'HOLDOUT' ? { split: entry.split } : {}),
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  return { goldVersion, snapshotId, entries: sortedEntries };
}

/**
 * Build the Git-safe Gold manifest. Contains only identity, fingerprints,
 * explicit split labels and (later, Task 5) PRIMARY/SECONDARY node ids; never
 * question stem/options/answer/analysis. sha256 is over the canonical payload
 * so identical input always yields an identical hash.
 */
export function buildGoldManifest(input) {
  const payload = canonicalManifestPayload(input.goldVersion, input.snapshotId, input.entries ?? []);
  const sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, sha256 };
}

/**
 * Fail-closed validation of a Gold manifest against the snapshot it claims to
 * describe. Rejects stale snapshots (snapshotId change), fingerprint drift,
 * missing/incorrect explicit split labels, split count drift, duplicate
 * questions, unknown questions and a tampered sha256. Errors are sorted so
 * output order is stable.
 */
export function validateGoldManifest(manifest, snapshot) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing'] };
  }
  if (typeof manifest.goldVersion !== 'string' || manifest.goldVersion.length === 0) {
    errors.push('manifest: goldVersion missing');
  }
  if (typeof manifest.snapshotId !== 'string' || manifest.snapshotId.length === 0) {
    errors.push('manifest: snapshotId missing');
  } else if (snapshot && manifest.snapshotId !== snapshot.snapshotId) {
    errors.push(`manifest: snapshotId ${manifest.snapshotId} does not match snapshot ${snapshot.snapshotId}`);
  }
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    errors.push('manifest: sha256 invalid');
  }
  if (!Array.isArray(manifest.entries)) {
    errors.push('manifest: entries missing');
    return { ok: false, errors: errors.sort() };
  }

  const recomputed = buildGoldManifest({
    goldVersion: manifest.goldVersion,
    snapshotId: manifest.snapshotId,
    entries: manifest.entries,
  });
  if (manifest.sha256 && recomputed.sha256 !== manifest.sha256) {
    errors.push('manifest: sha256 mismatch');
  }
  if (manifest.entries.length !== GOLD_TOTAL) {
    errors.push(`manifest: entries ${manifest.entries.length} != ${GOLD_TOTAL}`);
  }

  const byQuestion = new Map((snapshot?.questions ?? []).map((question) => [question.id, question]));
  const seen = new Set();
  const devBySubject = {};
  const holdoutBySubject = {};
  const bySubject = {};
  for (const entry of manifest.entries) {
    if (seen.has(entry.questionId)) {
      errors.push(`manifest: duplicate question ${entry.questionId}`);
    }
    seen.add(entry.questionId);
    if (!byQuestion.has(entry.questionId)) {
      errors.push(`manifest: unknown question ${entry.questionId}`);
      continue;
    }
    const question = byQuestion.get(entry.questionId);
    if (entry.contentFingerprint !== question.contentFingerprint) {
      errors.push(`manifest: fingerprint drift for question ${entry.questionId}`);
    }
    if (entry.split !== 'DEV' && entry.split !== 'HOLDOUT') {
      errors.push(`manifest: question ${entry.questionId} missing explicit split`);
      continue;
    }
    bySubject[question.subject] = (bySubject[question.subject] ?? 0) + 1;
    if (entry.split === 'DEV') devBySubject[question.subject] = (devBySubject[question.subject] ?? 0) + 1;
    else holdoutBySubject[question.subject] = (holdoutBySubject[question.subject] ?? 0) + 1;
  }

  const devTotal = Object.values(devBySubject).reduce((sum, count) => sum + count, 0);
  const holdoutTotal = Object.values(holdoutBySubject).reduce((sum, count) => sum + count, 0);
  if (devTotal !== DEV_TOTAL) errors.push(`manifest: DEV total ${devTotal} != ${DEV_TOTAL}`);
  if (holdoutTotal !== HOLDOUT_TOTAL) errors.push(`manifest: HOLDOUT total ${holdoutTotal} != ${HOLDOUT_TOTAL}`);
  for (const subject of SUBJECTS) {
    if ((bySubject[subject] ?? 0) !== GOLD_PER_SUBJECT) {
      errors.push(`manifest: subject ${subject} has ${bySubject[subject] ?? 0} gold questions, expected ${GOLD_PER_SUBJECT}`);
    }
    if ((devBySubject[subject] ?? 0) !== 6) {
      errors.push(`manifest: subject ${subject} DEV ${devBySubject[subject] ?? 0} != 6`);
    }
    if ((holdoutBySubject[subject] ?? 0) !== 4) {
      errors.push(`manifest: subject ${subject} HOLDOUT ${holdoutBySubject[subject] ?? 0} != 4`);
    }
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}
