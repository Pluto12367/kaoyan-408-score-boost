import { createHash } from 'node:crypto';

export const SNAPSHOT_SCHEMA_VERSION = 'annotation-snapshot-v1';
export const VALID_SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
export const SNAPSHOT_ROLES = ['INDEPENDENT_UNIT', 'EXACT_DUPLICATE_COPY', 'HISTORICAL_ONLY'];

function fullWidthToHalf(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  if (code === 0x3000) return ' ';
  return char;
}

function normalizeText(value) {
  let text = String(value ?? '').trim();
  text = [...text].map(fullWidthToHalf).join('');
  text = text.toLowerCase();
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/[，、]/g, ',');
  text = text.replace(/[。]/g, '.');
  text = text.replace(/[；]/g, ';');
  text = text.replace(/[：]/g, ':');
  text = text.replace(/[！]/g, '!');
  text = text.replace(/[？]/g, '?');
  text = text.replace(/[\u2013\u2014\u2212_-]/g, '-');
  text = text.replace(/[·•]/g, '-');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

/**
 * Audit-only normalized fingerprint over question content. Deterministic; does
 * NOT match production computeContentFingerprint (which is unnormalized and
 * includes difficulty/type/source/year/expectedTimeSec/knowledgePointIds).
 */
export function fingerprintPayloadHash(question) {
  const payload = {
    stem: normalizeText(question.stem),
    options: (question.options ?? []).map((option) => normalizeText(option)),
    answer: normalizeText(question.answer),
    analysis: normalizeText(question.analysis),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Canonical content hash over question/knowledgePoint/relation/node data.
 * Excludes identity, counts and roles (bank content only). Sorting is
 * deterministic so validation is input-order independent.
 */
export function snapshotContentHash(snapshot) {
  const sortById = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = {
    questions: sortById(snapshot.questions ?? []),
    knowledgePoints: sortById(snapshot.knowledgePoints ?? []),
    questionKnowledgePoints: [...(snapshot.questionKnowledgePoints ?? [])].sort(
      (a, b) => a.questionId.localeCompare(b.questionId) || a.knowledgePointId.localeCompare(b.knowledgePointId),
    ),
    nodes: sortById(snapshot.nodes ?? []),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Deterministic annotation role classification.
 * - HISTORICAL_ONLY: isCurrent === false
 * - current rows sharing a contentFingerprint: lexicographically smallest id is
 *   the INDEPENDENT_UNIT representative; the rest are EXACT_DUPLICATE_COPY
 * - all other current rows: INDEPENDENT_UNIT
 * familyId is NEVER used (it is version lineage, not a duplicate signal);
 * normalized-only duplicates are never merged here.
 */
export function classifyRoles(rows) {
  const currentByFingerprint = new Map();
  for (const row of rows) {
    if (!row.isCurrent || row.contentFingerprint == null) continue;
    const ids = currentByFingerprint.get(row.contentFingerprint) ?? [];
    ids.push(row.id);
    currentByFingerprint.set(row.contentFingerprint, ids);
  }

  const roles = {};
  const duplicateRepresentative = {};
  for (const [, ids] of currentByFingerprint) {
    if (ids.length < 2) continue;
    const representative = [...ids].sort()[0];
    for (const id of ids) {
      if (id === representative) {
        roles[id] = 'INDEPENDENT_UNIT';
        duplicateRepresentative[id] = null;
      } else {
        roles[id] = 'EXACT_DUPLICATE_COPY';
        duplicateRepresentative[id] = representative;
      }
    }
  }

  for (const row of rows) {
    if (roles[row.id] !== undefined) continue;
    roles[row.id] = row.isCurrent ? 'INDEPENDENT_UNIT' : 'HISTORICAL_ONLY';
    if (duplicateRepresentative[row.id] === undefined) duplicateRepresentative[row.id] = null;
  }

  const sortedIds = [...new Set(rows.map((row) => row.id))].sort();
  const sortedRoles = {};
  const sortedRepresentatives = {};
  for (const id of sortedIds) {
    sortedRoles[id] = roles[id];
    sortedRepresentatives[id] = duplicateRepresentative[id] ?? null;
  }
  return { roles: sortedRoles, duplicateRepresentative: sortedRepresentatives };
}

function validateReferenceIntegrity(snapshot, errors) {
  const questionIds = new Set((snapshot.questions ?? []).map((question) => question.id));
  const knowledgePointIds = new Set((snapshot.knowledgePoints ?? []).map((point) => point.id));
  const nodeIds = new Set((snapshot.nodes ?? []).map((node) => node.id));
  for (const relation of snapshot.questionKnowledgePoints ?? []) {
    if (!questionIds.has(relation.questionId)) {
      errors.push(`relation:${relation.questionId}->${relation.knowledgePointId} missing question`);
    }
    if (!knowledgePointIds.has(relation.knowledgePointId)) {
      errors.push(`relation:${relation.questionId}->${relation.knowledgePointId} missing knowledgePoint`);
    }
  }
  for (const node of snapshot.nodes ?? []) {
    if (node.parentId != null && !nodeIds.has(node.parentId)) {
      errors.push(`knowledgeNode:${node.id} missing parent ${node.parentId}`);
    }
    if (node.nodeType === 'atomicPoint' && !node.parentId) {
      errors.push(`knowledgeNode:${node.id} atomicPoint requires parentId`);
    }
  }
}

function validateUniqueness(items, label, errors) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`${label}:${item.id} duplicate id`);
    seen.add(item.id);
  }
}

function validateRoles(snapshot, errors) {
  const questionsById = new Map((snapshot.questions ?? []).map((question) => [question.id, question]));
  const roles = snapshot.roles ?? {};
  const representatives = snapshot.duplicateRepresentative ?? {};

  for (const question of snapshot.questions ?? []) {
    const role = roles[question.id];
    if (role === undefined) {
      errors.push(`question:${question.id} missing annotation role`);
      continue;
    }
    if (!SNAPSHOT_ROLES.includes(role)) {
      errors.push(`question:${question.id} invalid role ${role}`);
    }
    if (role === 'HISTORICAL_ONLY' && question.isCurrent) {
      errors.push(`question:${question.id} HISTORICAL_ONLY must be non-current`);
    }
    if (role === 'INDEPENDENT_UNIT' && !question.isCurrent) {
      errors.push(`question:${question.id} INDEPENDENT_UNIT must be current`);
    }
    if (role === 'EXACT_DUPLICATE_COPY' && !question.isCurrent) {
      errors.push(`question:${question.id} EXACT_DUPLICATE_COPY must be current`);
    }
  }

  for (const questionId of Object.keys(roles)) {
    if (!questionsById.has(questionId)) {
      errors.push(`role:${questionId} references unknown question`);
    }
  }

  for (const question of snapshot.questions ?? []) {
    const role = roles[question.id];
    const representative = representatives[question.id] ?? null;
    if (role === 'EXACT_DUPLICATE_COPY') {
      if (!representative) {
        errors.push(`question:${question.id} EXACT_DUPLICATE_COPY missing representative`);
        continue;
      }
      if (representative === question.id) {
        errors.push(`question:${question.id} representative points to itself`);
      }
      const representativeQuestion = questionsById.get(representative);
      if (!representativeQuestion) {
        errors.push(`question:${question.id} representative ${representative} missing`);
      } else if (roles[representative] !== 'INDEPENDENT_UNIT') {
        errors.push(`question:${question.id} representative ${representative} not INDEPENDENT_UNIT`);
      } else if (representativeQuestion.contentFingerprint !== question.contentFingerprint) {
        errors.push(`question:${question.id} fingerprint differs from representative ${representative}`);
      } else if (representatives[representative] != null) {
        errors.push(`question:${question.id} representative ${representative} has its own representative`);
      }
    } else if (representative != null) {
      errors.push(`question:${question.id} non-copy has non-null representative`);
    }
  }
}

/**
 * Fail-closed snapshot validation. Returns { ok, errors }; errors are sorted
 * so identical input always yields identical error order. Never mutates input.
 */
export function validateSnapshot(snapshot) {
  const errors = [];

  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`snapshot: unsupported schemaVersion ${snapshot.schemaVersion}`);
  }
  if (typeof snapshot.snapshotId !== 'string' || snapshot.snapshotId.length === 0) {
    errors.push('snapshot: snapshotId missing');
  }
  if (typeof snapshot.sourceCommit !== 'string' || snapshot.sourceCommit.length === 0) {
    errors.push('snapshot: sourceCommit missing');
  }
  const generatedAt = new Date(snapshot.generatedAt);
  if (typeof snapshot.generatedAt !== 'string' || Number.isNaN(generatedAt.getTime())) {
    errors.push(`snapshot: invalid generatedAt ${snapshot.generatedAt}`);
  }

  const counts = snapshot.counts ?? {};
  const questionCount = (snapshot.questions ?? []).length;
  const currentCount = (snapshot.questions ?? []).filter((question) => question.isCurrent).length;
  const nonCurrentCount = questionCount - currentCount;
  if (typeof counts.totalRows !== 'number' || counts.totalRows !== questionCount) {
    errors.push(`snapshot: counts.totalRows ${counts.totalRows} != questions ${questionCount}`);
  }
  if (counts.currentRows !== undefined && counts.currentRows !== currentCount) {
    errors.push(`snapshot: counts.currentRows ${counts.currentRows} != current questions ${currentCount}`);
  }
  if (counts.nonCurrentRows !== undefined && counts.nonCurrentRows !== nonCurrentCount) {
    errors.push(`snapshot: counts.nonCurrentRows ${counts.nonCurrentRows} != non-current questions ${nonCurrentCount}`);
  }

  if (typeof snapshot.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.contentSha256)) {
    errors.push('snapshot: contentSha256 invalid');
  } else if (snapshotContentHash(snapshot) !== snapshot.contentSha256) {
    errors.push('snapshot: contentSha256 mismatch');
  }

  validateUniqueness(snapshot.questions ?? [], 'question', errors);
  validateUniqueness(snapshot.knowledgePoints ?? [], 'knowledgePoint', errors);
  validateUniqueness(snapshot.nodes ?? [], 'knowledgeNode', errors);

  for (const question of snapshot.questions ?? []) {
    if (!VALID_SUBJECTS.includes(question.subject)) errors.push(`question:${question.id} invalid subject ${question.subject}`);
  }
  for (const point of snapshot.knowledgePoints ?? []) {
    if (!VALID_SUBJECTS.includes(point.subject)) errors.push(`knowledgePoint:${point.id} invalid subject ${point.subject}`);
  }
  for (const node of snapshot.nodes ?? []) {
    if (!VALID_SUBJECTS.includes(node.subject)) errors.push(`knowledgeNode:${node.id} invalid subject ${node.subject}`);
  }

  validateReferenceIntegrity(snapshot, errors);
  validateRoles(snapshot, errors);

  return { ok: errors.length === 0, errors: errors.sort() };
}
