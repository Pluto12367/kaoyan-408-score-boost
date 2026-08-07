import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data', '408');

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf8'));
}

const historical = loadJson('408-2009-2021-historical-question-index.json');
const tagEvidence = loadJson('historical-tag-evidence-2009-2025.json');

const subjectByTag = new Map(tagEvidence.tags.map((entry) => [entry.tag, entry.subject]));

function bucketOf(question) {
  if (question.primaryKnowledgePointId != null || question.secondaryKnowledgePointIds?.length) {
    return 'EXACT_ATOMIC_COMPLETE';
  }
  if (question.mappingStatus === 'source-tagged-broad') {
    const subjects = new Set(
      (question.historicalTags ?? [])
        .map((tag) => subjectByTag.get(tag))
        .filter(Boolean),
    );
    return subjects.size > 1 ? 'NEEDS_REVIEW' : 'BROAD_ONLY';
  }
  return 'UNMAPPED';
}

const buckets = {
  EXACT_ATOMIC_COMPLETE: [],
  BROAD_ONLY: [],
  UNMAPPED: [],
  NEEDS_REVIEW: [],
};

for (const question of historical.questions) {
  buckets[bucketOf(question)].push(question);
}

console.log('[audit-historical-408-tags]');
for (const [bucket, questions] of Object.entries(buckets)) {
  const byYear = countBy(questions, (question) => question.year);
  const bySubject = countBy(questions, (question) => question.subject);
  console.log(`${bucket}: ${questions.length}`);
  console.log(`  by year: ${formatCounts(byYear)}`);
  console.log(`  by subject: ${formatCounts(bySubject)}`);
}

// Prioritized review queue: newest year first, then higher broad tag evidence count,
// then questions whose tags span multiple years (combined topics first).
const reviewQueue = [...buckets.BROAD_ONLY, ...buckets.NEEDS_REVIEW, ...buckets.UNMAPPED]
  .map((question) => ({
    question,
    tagFrequency: (question.historicalTags ?? []).reduce(
      (sum, tag) => sum + (tagEvidence.tags.find((entry) => entry.tag === tag)?.questionCount ?? 0),
      0,
    ),
    tagYears: new Set(
      (question.historicalTags ?? []).flatMap((tag) => tagEvidence.tags.find((entry) => entry.tag === tag)?.years ?? []),
    ).size,
  }))
  .sort((left, right) => {
    if (right.question.year !== left.question.year) return right.question.year - left.question.year;
    if (right.tagYears !== left.tagYears) return right.tagYears - left.tagYears;
    return right.tagFrequency - left.tagFrequency;
  });

console.log(`\nReview queue (newest year first, combined topics first): ${reviewQueue.length} questions`);
for (const { question, tagFrequency, tagYears } of reviewQueue.slice(0, 20)) {
  console.log(
    `  ${question.id} ${question.year} ${question.subject} tags=${(question.historicalTags ?? []).join('|') || '-'} `
      + `tagYears=${tagYears} tagFrequency=${tagFrequency}`,
  );
}

function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}
