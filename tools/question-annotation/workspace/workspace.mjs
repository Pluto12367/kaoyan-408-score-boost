import { DatabaseSync } from 'node:sqlite';
import { validateSnapshot } from '../core/snapshot.js';

export const WORKSPACE_SCHEMA_VERSION = 'annotation-workspace-v1';
export const VALID_ANNOTATION_ROLES = ['INDEPENDENT_UNIT', 'EXACT_DUPLICATE_COPY', 'HISTORICAL_ONLY'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  content_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  question_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  stem TEXT NOT NULL,
  options TEXT NOT NULL,
  answer TEXT NOT NULL,
  analysis TEXT NOT NULL,
  difficulty TEXT,
  type TEXT,
  source TEXT,
  year INTEGER,
  expected_time_sec INTEGER,
  content_fingerprint TEXT,
  is_current INTEGER NOT NULL,
  family_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  annotation_role TEXT NOT NULL,
  duplicate_representative TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS knowledge_points (
  knowledge_point_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  title TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS question_knowledge_points (
  question_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (question_id, knowledge_point_id),
  FOREIGN KEY (question_id) REFERENCES questions(question_id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(knowledge_point_id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  node_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  parent_id TEXT,
  subject TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  chapter_name TEXT,
  section_name TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS gold_questions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS retrieval_results (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
`;

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function roleCounts(db) {
  const rows = db.prepare('SELECT annotation_role, COUNT(*) AS c FROM questions GROUP BY annotation_role').all();
  const counts = { INDEPENDENT_UNIT: 0, EXACT_DUPLICATE_COPY: 0, HISTORICAL_ONLY: 0 };
  for (const row of rows) counts[row.annotation_role] = row.c;
  return counts;
}

function buildSummary(db, imported) {
  const snapshot = db.prepare('SELECT snapshot_id, content_sha256 FROM snapshots LIMIT 1').get();
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshot_id,
    contentSha256: snapshot.content_sha256,
    imported,
    questionCount: count(db, 'questions'),
    knowledgePointCount: count(db, 'knowledge_points'),
    relationCount: count(db, 'question_knowledge_points'),
    nodeCount: count(db, 'knowledge_nodes'),
    roleCounts: roleCounts(db),
  };
}

export function openWorkspace(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  const versionRow = db.prepare("SELECT value FROM workspace_meta WHERE key = 'workspace_schema_version'").get();
  if (!versionRow) {
    db.prepare('INSERT INTO workspace_meta (key, value) VALUES (?, ?)').run('workspace_schema_version', WORKSPACE_SCHEMA_VERSION);
  } else if (versionRow.value !== WORKSPACE_SCHEMA_VERSION) {
    db.close();
    throw new Error(`workspace schema version mismatch: ${versionRow.value} != ${WORKSPACE_SCHEMA_VERSION}`);
  }
  return db;
}

/**
 * Import a validated snapshot into the workspace inside a single transaction.
 * - invalid snapshot → throw before any write
 * - same snapshotId + same contentSha256 → safe no-op
 * - same snapshotId + different contentSha256 → identity collision (throw)
 * - different snapshotId on a non-empty workspace → stale (throw; explicit reset is a future task decision)
 */
export function importSnapshot(db, snapshot) {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error(`snapshot validation failed: ${validation.errors.join('; ')}`);
  }
  const existing = db.prepare('SELECT snapshot_id, content_sha256 FROM snapshots LIMIT 1').get();
  if (existing) {
    if (existing.snapshot_id === snapshot.snapshotId && existing.content_sha256 === snapshot.contentSha256) {
      return buildSummary(db, false);
    }
    if (existing.snapshot_id === snapshot.snapshotId) {
      throw new Error(`snapshot identity collision: snapshotId ${snapshot.snapshotId} already imported with a different contentSha256`);
    }
    throw new Error(`stale snapshot: workspace is based on ${existing.snapshot_id}; importing ${snapshot.snapshotId} requires an explicit reset`);
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO snapshots (snapshot_id, schema_version, generated_at, source_commit, content_sha256) VALUES (?, ?, ?, ?, ?)',
    ).run(snapshot.snapshotId, snapshot.schemaVersion, snapshot.generatedAt, snapshot.sourceCommit, snapshot.contentSha256);

    const insertQuestion = db.prepare(
      `INSERT INTO questions (
        question_id, snapshot_id, subject, stem, options, answer, analysis,
        difficulty, type, source, year, expected_time_sec,
        content_fingerprint, is_current, family_id, version_number,
        annotation_role, duplicate_representative
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const question of snapshot.questions) {
      insertQuestion.run(
        question.id, snapshot.snapshotId, question.subject, question.stem,
        JSON.stringify(question.options ?? []), question.answer, question.analysis,
        question.difficulty ?? null, question.type ?? null, question.source ?? null, question.year ?? null,
        question.expectedTimeSec ?? null, question.contentFingerprint ?? null,
        question.isCurrent ? 1 : 0, question.familyId, question.versionNumber,
        snapshot.roles[question.id], snapshot.duplicateRepresentative[question.id] ?? null,
      );
    }

    const insertPoint = db.prepare(
      'INSERT INTO knowledge_points (knowledge_point_id, snapshot_id, subject, chapter, title) VALUES (?, ?, ?, ?, ?)',
    );
    for (const point of snapshot.knowledgePoints) {
      insertPoint.run(point.id, snapshot.snapshotId, point.subject, point.chapter, point.title);
    }

    const insertRelation = db.prepare(
      'INSERT INTO question_knowledge_points (question_id, knowledge_point_id, snapshot_id) VALUES (?, ?, ?)',
    );
    for (const relation of snapshot.questionKnowledgePoints) {
      insertRelation.run(relation.questionId, relation.knowledgePointId, snapshot.snapshotId);
    }

    const insertNode = db.prepare(
      `INSERT INTO knowledge_nodes (
        node_id, snapshot_id, parent_id, subject, node_type, name, is_active, chapter_name, section_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const node of snapshot.nodes) {
      insertNode.run(
        node.id, snapshot.snapshotId, node.parentId ?? null, node.subject, node.nodeType, node.name,
        node.isActive ? 1 : 0, node.chapterName ?? null, node.sectionName ?? null,
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return buildSummary(db, true);
}

export function getWorkspaceSummary(db) {
  return buildSummary(db, false);
}

export function listQuestions(db) {
  const rows = db.prepare(
    `SELECT question_id, subject, stem, options, answer, analysis, difficulty, type, source, year,
            expected_time_sec, content_fingerprint, is_current, family_id, version_number,
            annotation_role, duplicate_representative
     FROM questions ORDER BY question_id ASC`,
  ).all();
  return rows.map((row) => ({
    questionId: row.question_id,
    subject: row.subject,
    stem: row.stem,
    options: JSON.parse(row.options ?? '[]'),
    answer: row.answer,
    analysis: row.analysis,
    difficulty: row.difficulty,
    type: row.type,
    source: row.source,
    year: row.year,
    expectedTimeSec: row.expected_time_sec,
    contentFingerprint: row.content_fingerprint,
    isCurrent: Boolean(row.is_current),
    familyId: row.family_id,
    versionNumber: row.version_number,
    annotationRole: row.annotation_role,
    duplicateRepresentative: row.duplicate_representative,
  }));
}

export function listNodes(db) {
  return db.prepare(
    `SELECT node_id, parent_id, subject, node_type, name, is_active, chapter_name, section_name
     FROM knowledge_nodes ORDER BY node_id ASC`,
  ).all().map((row) => ({
    nodeId: row.node_id,
    parentId: row.parent_id,
    subject: row.subject,
    nodeType: row.node_type,
    name: row.name,
    isActive: Boolean(row.is_active),
    chapterName: row.chapter_name,
    sectionName: row.section_name,
  }));
}

export function validateWorkspace(db) {
  const errors = [];
  const versionRow = db.prepare("SELECT value FROM workspace_meta WHERE key = 'workspace_schema_version'").get();
  if (!versionRow || versionRow.value !== WORKSPACE_SCHEMA_VERSION) {
    errors.push('workspace: schema version missing or mismatch');
  }
  const snapshot = db.prepare('SELECT * FROM snapshots LIMIT 1').get();
  if (!snapshot) {
    errors.push('workspace: no snapshot imported');
    return { ok: false, errors };
  }

  const questionRows = db.prepare('SELECT question_id, annotation_role, duplicate_representative FROM questions').all();
  const questionIds = new Set(questionRows.map((row) => row.question_id));
  for (const row of questionRows) {
    if (!VALID_ANNOTATION_ROLES.includes(row.annotation_role)) {
      errors.push(`question:${row.question_id} invalid annotation role ${row.annotation_role}`);
    }
    if (row.annotation_role === 'EXACT_DUPLICATE_COPY') {
      if (!row.duplicate_representative) {
        errors.push(`question:${row.question_id} EXACT_DUPLICATE_COPY missing representative`);
      } else if (!questionIds.has(row.duplicate_representative)) {
        errors.push(`question:${row.question_id} representative ${row.duplicate_representative} missing`);
      }
    } else if (row.duplicate_representative != null) {
      errors.push(`question:${row.question_id} non-copy has non-null representative`);
    }
  }

  for (const row of db.prepare('SELECT question_id, knowledge_point_id FROM question_knowledge_points').all()) {
    if (!questionIds.has(row.question_id)) errors.push(`relation:${row.question_id}->${row.knowledge_point_id} missing question`);
    if (!db.prepare('SELECT 1 FROM knowledge_points WHERE knowledge_point_id = ?').get(row.knowledge_point_id)) {
      errors.push(`relation:${row.question_id}->${row.knowledge_point_id} missing knowledgePoint`);
    }
  }
  for (const row of db.prepare('SELECT node_id, parent_id FROM knowledge_nodes').all()) {
    if (row.parent_id != null && !db.prepare('SELECT 1 FROM knowledge_nodes WHERE node_id = ?').get(row.parent_id)) {
      errors.push(`knowledgeNode:${row.node_id} missing parent ${row.parent_id}`);
    }
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}
