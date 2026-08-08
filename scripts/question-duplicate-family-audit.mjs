import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const SUBJECT_CODE = {
  DATA_STRUCTURE: 'DS',
  COMPUTER_ORGANIZATION: 'CO',
  OPERATING_SYSTEM: 'OS',
  COMPUTER_NETWORK: 'CN',
};

const OUTPUT = join(process.cwd(), 'data', '408', 'knowledge-catalog', 'question-duplicate-family-audit.json');

function fullWidthToHalf(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  if (code === 0x3000) return ' ';
  return char;
}

function normalizeContent(text) {
  let value = String(text ?? '').trim();
  value = [...value].map(fullWidthToHalf).join('');
  value = value.toLowerCase();
  value = value.replace(/[\u2018\u2019]/g, "'");
  value = value.replace(/[\u201C\u201D]/g, '"');
  value = value.replace(/[，、]/g, ',');
  value = value.replace(/[。]/g, '.');
  value = value.replace(/[；]/g, ';');
  value = value.replace(/[：]/g, ':');
  value = value.replace(/[！]/g, '!');
  value = value.replace(/[？]/g, '?');
  value = value.replace(/[\u2013\u2014\u2212_-]/g, '-');
  value = value.replace(/[·•]/g, '-');
  value = value.replace(/\s+/g, ' ');
  return value.trim();
}

function auditNormalizedFingerprint(question) {
  const payload = {
    stem: normalizeContent(question.stem),
    options: (question.options ?? []).map((option) => normalizeContent(option)),
    answer: normalizeContent(question.answer),
    analysis: normalizeContent(question.analysis),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function truncate(text, length = 80) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for a read-only duplicate/family audit');
  }
  const prisma = new PrismaClient();
  try {
    const [questions, knowledgePoints, questionLinks] = await Promise.all([
      prisma.question.findMany({
        select: {
          id: true,
          familyId: true,
          versionNumber: true,
          isCurrent: true,
          contentFingerprint: true,
          stem: true,
          options: true,
          answer: true,
          analysis: true,
          difficulty: true,
          type: true,
          source: true,
          year: true,
        },
      }),
      prisma.knowledgePoint.findMany({ select: { id: true, subject: true } }),
      prisma.questionKnowledgePoint.findMany({ select: { questionId: true, knowledgePointId: true } }),
    ]);

    const kpById = new Map(knowledgePoints.map((kp) => [kp.id, kp]));
    const subjectByQuestion = new Map();
    for (const link of questionLinks) {
      const kp = kpById.get(link.knowledgePointId);
      if (kp && kp.subject in SUBJECT_CODE) {
        subjectByQuestion.set(link.questionId, SUBJECT_CODE[kp.subject]);
      }
    }

    const rows = questions.map((q) => {
      const fingerprint = q.contentFingerprint;
      const fingerprintPresent = typeof fingerprint === 'string' && fingerprint.length > 0;
      return {
        id: q.id,
        familyId: q.familyId,
        versionNumber: q.versionNumber,
        isCurrent: q.isCurrent,
        contentFingerprint: fingerprint,
        fingerprintPresent,
        auditNormalizedFingerprint: auditNormalizedFingerprint(q),
        stem: q.stem,
        options: q.options ?? [],
        answer: q.answer,
        analysis: q.analysis,
        difficulty: q.difficulty,
        type: q.type,
        source: q.source,
        year: q.year,
        subject: subjectByQuestion.get(q.id) ?? 'UNKNOWN',
      };
    });

    const totalRows = rows.length;
    const currentRows = rows.filter((row) => row.isCurrent);
    const nonCurrentRows = rows.filter((row) => !row.isCurrent);

    const fingerprintGroups = groupBy(rows, (row) => row.contentFingerprint);
    const duplicateFingerprintGroups = [...fingerprintGroups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([fingerprint, members]) => ({ fingerprint, members }))
      .sort((a, b) => b.members.length - a.members.length || a.fingerprint.localeCompare(b.fingerprint));
    const duplicateRows = duplicateFingerprintGroups.flatMap((group) => group.members);
    const largestDuplicateGroup = duplicateFingerprintGroups.length
      ? duplicateFingerprintGroups[0].members.length
      : 0;

    const currentFingerprintGroups = groupBy(currentRows, (row) => row.contentFingerprint);
    const currentDuplicateGroups = [...currentFingerprintGroups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([fingerprint, members]) => ({ fingerprint, members }))
      .sort((a, b) => b.members.length - a.members.length || a.fingerprint.localeCompare(b.fingerprint));
    const currentDuplicateRows = currentDuplicateGroups.flatMap((group) => group.members);

    const normalizedGroups = groupBy(rows, (row) => row.auditNormalizedFingerprint);
    const normalizedDuplicateGroups = [...normalizedGroups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([fingerprint, members]) => ({ fingerprint, members }))
      .sort((a, b) => b.members.length - a.members.length || a.fingerprint.localeCompare(b.fingerprint));
    const normalizedDuplicateRows = normalizedDuplicateGroups.flatMap((group) => group.members);

    const familyGroups = groupBy(rows, (row) => row.familyId);
    const familyAudit = [...familyGroups.entries()]
      .map(([familyId, members]) => {
        const fingerprints = [...new Set(members.map((row) => row.contentFingerprint))];
        const currentCount = members.filter((row) => row.isCurrent).length;
        let classification;
        if (fingerprints.length === 1 && members.length > 1) classification = 'EXACT_DUPLICATE_FAMILY';
        else if (currentCount > 1) classification = 'VARIANT_FAMILY';
        else if (currentCount === 1) classification = 'HISTORICAL_VERSION_FAMILY';
        else classification = 'AMBIGUOUS_FAMILY';
        return {
          familyId,
          questionCount: members.length,
          currentCount,
          questionIds: members.map((row) => row.id),
          versionNumbers: members.map((row) => row.versionNumber),
          contentFingerprints: fingerprints,
          classification,
          stemPreviews: members.map((row) => truncate(row.stem, 60)),
        };
      })
      .sort((a, b) => b.questionCount - a.questionCount || a.familyId.localeCompare(b.familyId));

    const representativeByFingerprint = new Set();
    for (const group of currentDuplicateGroups) {
      representativeByFingerprint.add(group.members[0].id);
    }
    const representativeIds = new Set(representativeByFingerprint);
    const classification = new Map();
    for (const row of currentRows) {
      if (row.contentFingerprint && currentFingerprintGroups.get(row.contentFingerprint)?.length > 1) {
        classification.set(row.id, representativeIds.has(row.id) ? 'CURRENT_UNIQUE' : 'CURRENT_EXACT_DUPLICATE');
      } else if (familyGroups.get(row.familyId)?.filter((member) => member.isCurrent).length > 1) {
        classification.set(row.id, 'CURRENT_VARIANT_FAMILY_MEMBER');
      } else {
        classification.set(row.id, 'CURRENT_STANDALONE');
      }
    }
    for (const row of nonCurrentRows) classification.set(row.id, 'NON_CURRENT_HISTORICAL_VERSION');
    for (const row of rows) {
      if (!classification.has(row.id)) classification.set(row.id, row.isCurrent ? 'AMBIGUOUS' : 'NON_CURRENT_HISTORICAL_VERSION');
    }
    for (const row of rows) {
      if (!row.fingerprintPresent) classification.set(row.id, 'AMBIGUOUS');
    }

    const currentUniqueRepresentatives = currentRows.filter(
      (row) => classification.get(row.id) === 'CURRENT_UNIQUE' || classification.get(row.id) === 'CURRENT_STANDALONE',
    );
    const variantFamilies = familyAudit.filter((family) => family.classification === 'VARIANT_FAMILY');
    const variantQuestionRows = variantFamilies.reduce((sum, family) => sum + family.questionCount, 0);
    const variantSiblingsBeyondRepresentative = variantFamilies.reduce(
      (sum, family) => sum + Math.max(0, family.questionCount - 1),
      0,
    );
    const independentTaggingUnits = currentUniqueRepresentatives.length;
    const reducedWorkload = Math.max(0, independentTaggingUnits - variantSiblingsBeyondRepresentative);

    const bySubject = (rowsToCount) => {
      const counts = { DS: 0, CO: 0, OS: 0, CN: 0, UNKNOWN: 0 };
      for (const row of rowsToCount) counts[row.subject] = (counts[row.subject] ?? 0) + 1;
      return counts;
    };

    const report = {
      generatedAt: new Date().toISOString(),
      semantics: {
        contentFingerprint: 'sha256(JSON{stem, options, answer, analysis, knowledgePointIds(sorted), difficulty, type, source, year, expectedTimeSec}); no internal normalization (callers trim); same fingerprint implies identical payload incl. KP binding',
        family: 'version lineage: teacher create => new family/version 1; update or import new_version => same family, versionNumber+1, old isCurrent=false',
        isCurrent: 'single current version per family expected; non-current = historical',
      },
      productionCounts: {
        totalRows,
        currentRows: currentRows.length,
        nonCurrentRows: nonCurrentRows.length,
      },
      fingerprintAudit: {
        fingerprintPresent: rows.filter((row) => row.fingerprintPresent).length,
        fingerprintMissing: rows.filter((row) => !row.fingerprintPresent).length,
        uniqueFingerprints: fingerprintGroups.size,
        duplicateFingerprintGroups: duplicateFingerprintGroups.length,
        duplicateRows: duplicateRows.length,
        largestDuplicateGroup,
      },
      currentOnlyFingerprintAudit: {
        currentRows: currentRows.length,
        currentUniqueFingerprints: currentFingerprintGroups.size,
        currentDuplicateFingerprintGroups: currentDuplicateGroups.length,
        currentDuplicateRows: currentDuplicateRows.length,
      },
      familyAudit: {
        questionsWithFamilyId: rows.filter((row) => row.familyId).length,
        questionsWithoutFamilyId: rows.filter((row) => !row.familyId).length,
        uniqueFamilies: familyGroups.size,
        multiQuestionFamilies: familyAudit.filter((family) => family.questionCount > 1).length,
        singleQuestionFamilies: familyAudit.filter((family) => family.questionCount === 1).length,
        maxFamilySize: familyAudit.length ? familyAudit[0].questionCount : 0,
        families: familyAudit,
        classificationCounts: familyAudit.reduce((acc, family) => {
          acc[family.classification] = (acc[family.classification] ?? 0) + 1;
          return acc;
        }, {}),
      },
      normalizedDuplicateAudit: {
        normalizedDuplicateGroups: normalizedDuplicateGroups.length,
        normalizedDuplicateRows: normalizedDuplicateRows.length,
        normalizedOnlyDuplicateGroups: normalizedDuplicateGroups.filter(
          (group) => new Set(group.members.map((row) => row.contentFingerprint)).size > 1,
        ).length,
      },
      finalClassification: {
        CURRENT_UNIQUE: currentRows.filter((row) => classification.get(row.id) === 'CURRENT_UNIQUE').length,
        CURRENT_EXACT_DUPLICATE: currentRows.filter((row) => classification.get(row.id) === 'CURRENT_EXACT_DUPLICATE').length,
        CURRENT_VARIANT_FAMILY_MEMBER: currentRows.filter((row) => classification.get(row.id) === 'CURRENT_VARIANT_FAMILY_MEMBER').length,
        CURRENT_STANDALONE: currentRows.filter((row) => classification.get(row.id) === 'CURRENT_STANDALONE').length,
        NON_CURRENT_HISTORICAL_VERSION: nonCurrentRows.length,
        AMBIGUOUS: rows.filter((row) => classification.get(row.id) === 'AMBIGUOUS').length,
      },
      workload: {
        uniqueCurrentRepresentatives: independentTaggingUnits,
        independentTaggingUnits,
        exactDuplicateGroups: currentDuplicateGroups.length,
        exactDuplicateRows: currentDuplicateRows.length,
        historicalNonCurrentRows: nonCurrentRows.length,
        variantFamilies: variantFamilies.length,
        variantQuestionRows,
        reducedWorkloadWithFamilyDiffReview: reducedWorkload,
      },
      perSubject: {
        currentUniqueRepresentatives: bySubject(currentUniqueRepresentatives),
        independentTaggingUnits: bySubject(currentUniqueRepresentatives),
      },
      exactDuplicateSample: currentDuplicateGroups.slice(0, 10).map((group) => ({
        fingerprint: group.fingerprint,
        questionIds: group.members.map((row) => row.id),
        count: group.members.length,
        isCurrentValues: group.members.map((row) => row.isCurrent),
        familyIds: [...new Set(group.members.map((row) => row.familyId))],
        versionNumbers: group.members.map((row) => row.versionNumber),
        stemPreview: truncate(group.members[0].stem, 80),
        identicalContent: group.members.every(
          (row) =>
            row.stem === group.members[0].stem
            && JSON.stringify(row.options) === JSON.stringify(group.members[0].options)
            && row.answer === group.members[0].answer
            && row.analysis === group.members[0].analysis,
        ),
      })),
      variantFamilySample: variantFamilies.slice(0, 10).map((family) => ({
        familyId: family.familyId,
        members: family.questionIds,
        currentMemberIds: family.questionIds,
        versionNumbers: family.versionNumbers,
        fingerprints: family.contentFingerprints,
        stemPreviews: family.stemPreviews,
        reason: 'multiple current versions with distinct content; cannot be merged deterministically',
      })),
      normalizedDuplicateSample: normalizedDuplicateGroups.slice(0, 10).map((group) => ({
        fingerprint: group.fingerprint,
        questionIds: group.members.map((row) => row.id),
        count: group.members.length,
        dbFingerprints: [...new Set(group.members.map((row) => row.contentFingerprint))],
        stemPreviews: group.members.map((row) => truncate(row.stem, 60)),
      })),
    };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`totalRows: ${totalRows}`);
    console.log(`currentRows: ${currentRows.length}`);
    console.log(`nonCurrentRows: ${nonCurrentRows.length}`);
    console.log(`uniqueFingerprints: ${fingerprintGroups.size}`);
    console.log(`duplicateFingerprintGroups: ${duplicateFingerprintGroups.length}`);
    console.log(`duplicateRows: ${duplicateRows.length}`);
    console.log(`largestDuplicateGroup: ${largestDuplicateGroup}`);
    console.log(`currentUniqueFingerprints: ${currentFingerprintGroups.size}`);
    console.log(`currentDuplicateFingerprintGroups: ${currentDuplicateGroups.length}`);
    console.log(`currentDuplicateRows: ${currentDuplicateRows.length}`);
    console.log(`normalizedDuplicateGroups: ${normalizedDuplicateGroups.length}`);
    console.log(`normalizedDuplicateRows: ${normalizedDuplicateRows.length}`);
    console.log(`families: ${familyGroups.size} (multi=${familyAudit.filter((f) => f.questionCount > 1).length}, single=${familyAudit.filter((f) => f.questionCount === 1).length}, maxSize=${familyAudit.length ? familyAudit[0].questionCount : 0})`);
    console.log(`familyClassificationCounts: ${JSON.stringify(report.familyAudit.classificationCounts)}`);
    console.log(`finalClassification: ${JSON.stringify(report.finalClassification)}`);
    console.log(`uniqueCurrentRepresentatives: ${independentTaggingUnits}`);
    console.log(`exactDuplicateRows: ${currentDuplicateRows.length}`);
    console.log(`historicalNonCurrentRows: ${nonCurrentRows.length}`);
    console.log(`variantFamilies: ${variantFamilies.length} (rows=${variantQuestionRows})`);
    console.log(`independentTaggingUnits: ${independentTaggingUnits}`);
    console.log(`reducedWorkloadWithFamilyDiffReview: ${reducedWorkload}`);
    console.log(`perSubjectUnique: ${JSON.stringify(bySubject(currentUniqueRepresentatives))}`);
    console.log(`Audit written to ${OUTPUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[question-duplicate-family-audit] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
