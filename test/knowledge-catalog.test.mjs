import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildKnowledgePointIndex,
  buildKnowledgeTree,
  filterKnowledgeTree,
  joinChapterSectionStats,
  joinFrequencyEvidence,
  resolveKnowledgePointRefs,
  searchKnowledgeTree,
  summarizeSubject,
} from '../packages/shared/dist/index.js';

const tree = JSON.parse(
  readFileSync(new URL('../data/408/knowledge-tree-408-v2.json', import.meta.url), 'utf8'),
);
const frequency = JSON.parse(
  readFileSync(new URL('../data/408/frequency-model-v2.json', import.meta.url), 'utf8'),
);
const statsFile = JSON.parse(
  readFileSync(new URL('../data/408/knowledge-catalog/chapter-section-stats-2022-2026.json', import.meta.url), 'utf8'),
);

const rawCounts = {};
for (const node of tree.nodes) {
  rawCounts[node.nodeType] = (rawCounts[node.nodeType] ?? 0) + 1;
}

function walkPoints(catalog, visitor) {
  for (const subject of Object.values(catalog)) {
    for (const chapter of subject.chapters) {
      for (const section of chapter.sections) {
        for (const point of section.points) visitor(point, subject, chapter, section);
      }
    }
  }
}

function assertOrdered(items) {
  for (let index = 1; index < items.length; index += 1) {
    assert.ok(
      items[index - 1].order <= items[index].order,
      `${items[index].id} should not be ordered before ${items[index - 1].id}`,
    );
  }
}

test('A: complete knowledge tree builds 4 subjects / 24 chapters / 119 sections / 1149 atomic points', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const codes = Object.keys(catalog);
  assert.equal(codes.length, 4);

  let chapterCount = 0;
  let sectionCount = 0;
  let atomicPointCount = 0;
  for (const subject of Object.values(catalog)) {
    chapterCount += subject.chapters.length;
    for (const chapter of subject.chapters) {
      sectionCount += chapter.sections.length;
      for (const section of chapter.sections) atomicPointCount += section.points.length;
    }
  }
  assert.equal(chapterCount, rawCounts.chapter);
  assert.equal(sectionCount, rawCounts.section);
  assert.equal(atomicPointCount, rawCounts.atomicPoint);
  assert.equal(chapterCount, 24);
  assert.equal(sectionCount, 119);
  assert.equal(atomicPointCount, 1149);
});

test('B: all four subjects exist with canonical names', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const expected = {
    DS: '数据结构',
    CO: '计算机组成原理',
    OS: '操作系统',
    CN: '计算机网络',
  };
  for (const [code, name] of Object.entries(expected)) {
    assert.equal(catalog[code].code, code, `subject ${code} code`);
    assert.equal(catalog[code].name, name, `subject ${code} name`);
  }
});

test('C: every chapter/section/atomicPoint has a valid parent and build fails fast on orphans', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  walkPoints(catalog, (point) => {
    assert.ok(point.id, 'atomic point must keep its stable id');
  });

  const orphanNodes = [
    { id: 'DS', nodeType: 'subject', subject: 'DS', name: '数据结构', parentId: null, order: 1, importance: 5, difficulty: 4 },
    { id: 'DS-C01', nodeType: 'chapter', subject: 'DS', name: '缺失父节点章节', parentId: 'DS-MISSING', order: 1, importance: 3, difficulty: 2 },
  ];
  assert.throws(() => buildKnowledgeTree(orphanNodes), /DS-C01/);
});

test('C2: unsupported subject or nodeType fails fast', () => {
  const badSubject = [
    { id: 'XX', nodeType: 'subject', subject: 'XX', name: '未知', parentId: null, order: 1, importance: 5, difficulty: 4 },
  ];
  assert.throws(() => buildKnowledgeTree(badSubject), /XX/);

  const badType = [
    { id: 'DS', nodeType: 'subject', subject: 'DS', name: '数据结构', parentId: null, order: 1, importance: 5, difficulty: 4 },
    { id: 'DS-C01', nodeType: 'mystery', subject: 'DS', name: '异常类型', parentId: 'DS', order: 1, importance: 3, difficulty: 2 },
  ];
  assert.throws(() => buildKnowledgeTree(badType), /DS-C01/);
});

test('D: chapters and sections are ordered by order; points preserve raw tree order', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  for (const subject of Object.values(catalog)) {
    assertOrdered(subject.chapters);
    for (const chapter of subject.chapters) {
      assertOrdered(chapter.sections);
      for (const section of chapter.sections) {
        const expected = tree.nodes
          .filter((node) => node.parentId === section.id && node.nodeType === 'atomicPoint')
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
          .map((node) => ({ id: node.id, order: node.order }));
        assert.deepEqual(
          section.points.map((point) => ({ id: point.id, order: point.order })),
          expected,
          `${section.id} should preserve raw point order and sort by order then id`,
        );
      }
    }
  }
});

test('E: frequency evidence joins to every atomic point by stable id', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  let total = 0;
  let withEvidence = 0;
  walkPoints(joined, (point) => {
    total += 1;
    if (point.evidence) withEvidence += 1;
  });
  assert.equal(total, 1149);
  assert.equal(withEvidence, 1149);

  const item = frequency.items.find((entry) => entry.knowledgePointId === 'CO-C05-S03-P07');
  assert.ok(item, 'spot-check frequency item should exist');
  let spot;
  walkPoints(joined, (point) => {
    if (point.id === 'CO-C05-S03-P07') spot = point;
  });
  assert.ok(spot, 'spot-check atomic point should exist');
  assert.deepEqual(spot.evidence, {
    recent3Frequency: item.recent3Y.frequency,
    recent5Frequency: item.recent5Y.frequency,
    allTimeEvidence: item.allTimeEvidence.frequency,
    trendDirection: item.trend.direction,
    trendDelta: item.trend.delta,
    evidenceConfidence: item.evidenceConfidence,
    primaryScore5y: item.recent5Y.primaryScore,
  });
});

test('F: unknown frequency ids never create ghost atomic points', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, [
    ...frequency.items,
    {
      knowledgePointId: 'UNKNOWN-NODE-ID',
      recent3Y: { frequency: 5 },
      recent5Y: { frequency: 5, primaryScore: 99 },
      allTimeEvidence: { frequency: 5 },
      trend: { direction: 'rising', delta: 1 },
      evidenceConfidence: 'high',
    },
  ]);
  let total = 0;
  let unknown = 0;
  walkPoints(joined, (point) => {
    total += 1;
    if (point.id === 'UNKNOWN-NODE-ID') unknown += 1;
  });
  assert.equal(total, 1149);
  assert.equal(unknown, 0);
});

test('G: build and join never mutate their inputs', () => {
  const nodesSnapshot = JSON.stringify(tree.nodes);
  const itemsSnapshot = JSON.stringify(frequency.items);
  const catalog = buildKnowledgeTree(tree.nodes);
  const catalogSnapshot = JSON.stringify(catalog);
  joinFrequencyEvidence(catalog, frequency.items);
  assert.equal(JSON.stringify(tree.nodes), nodesSnapshot);
  assert.equal(JSON.stringify(frequency.items), itemsSnapshot);
  assert.equal(JSON.stringify(catalog), catalogSnapshot);
});

test('H: summarizeSubject counts match the real tree for DS', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const summary = summarizeSubject(catalog.DS);
  const rawDsChapters = tree.nodes.filter(
    (node) => node.subject === 'DS' && node.nodeType === 'chapter',
  ).length;
  const rawDsSections = tree.nodes.filter(
    (node) => node.subject === 'DS' && node.nodeType === 'section',
  ).length;
  const rawDsPoints = tree.nodes.filter(
    (node) => node.subject === 'DS' && node.nodeType === 'atomicPoint',
  ).length;
  assert.deepEqual(summary, {
    chapterCount: rawDsChapters,
    sectionCount: rawDsSections,
    atomicPointCount: rawDsPoints,
  });
});

function collectPoints(subject) {
  return subject.chapters.flatMap((chapter) =>
    chapter.sections.flatMap((section) => section.points),
  );
}

function collectAllPoints(catalog) {
  return ['DS', 'CO', 'OS', 'CN'].flatMap((code) => collectPoints(catalog[code]));
}

test('I: high-frequency filter keeps only recent5Frequency >= 4 and prunes below total', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const original = collectPoints(joined.DS);
  const filtered = filterKnowledgeTree(joined.DS, { onlyHighFrequency: true });
  const points = collectPoints(filtered);
  assert.ok(points.length > 0, 'high-frequency filter should return results');
  assert.ok(points.length < original.length, 'high-frequency filter should reduce the total');
  for (const point of points) {
    assert.ok(point.evidence != null, 'filtered point must have evidence');
    assert.ok(point.evidence.recent5Frequency >= 4, 'filtered point must be recent5Frequency >= 4');
  }
});

test('J: importance filter keeps only importance >= 4', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const filtered = filterKnowledgeTree(joined.DS, { onlyHighImportance: true });
  const points = collectPoints(filtered);
  assert.ok(points.length > 0);
  for (const point of points) {
    assert.ok(point.importance >= 4, 'filtered point must be importance >= 4');
  }
});

test('K: combined filter is AND, not OR', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const highFreq = collectPoints(filterKnowledgeTree(joined.DS, { onlyHighFrequency: true }));
  const highImportance = collectPoints(filterKnowledgeTree(joined.DS, { onlyHighImportance: true }));
  const combined = collectPoints(filterKnowledgeTree(joined.DS, {
    onlyHighFrequency: true,
    onlyHighImportance: true,
  }));
  assert.ok(combined.length > 0);
  assert.ok(combined.length <= highFreq.length && combined.length <= highImportance.length);
  for (const point of combined) {
    assert.ok(point.evidence != null && point.evidence.recent5Frequency >= 4, 'AND: recent5Frequency >= 4');
    assert.ok(point.importance >= 4, 'AND: importance >= 4');
  }
  const highFreqOnly = highFreq.filter((point) => point.importance < 4);
  const importanceOnly = highImportance.filter(
    (point) => point.evidence == null || point.evidence.recent5Frequency < 4,
  );
  assert.ok(
    combined.length < highFreq.length || combined.length < highImportance.length,
    'combined must be stricter than either single filter',
  );
  assert.ok(highFreqOnly.length > 0 || importanceOnly.length > 0, 'single dimensions should differ from combined');
});

test('L: filtered tree prunes empty sections and chapters', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  for (const options of [
    { onlyHighFrequency: true },
    { onlyHighImportance: true },
    { onlyHighFrequency: true, onlyHighImportance: true },
  ]) {
    const filtered = filterKnowledgeTree(joined.DS, options);
    for (const chapter of filtered.chapters) {
      assert.ok(chapter.sections.length > 0, 'chapter must keep at least one section');
      for (const section of chapter.sections) {
        assert.ok(section.points.length > 0, 'section must keep at least one point');
      }
    }
  }
});

test('M: filterKnowledgeTree never mutates the input subject', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const snapshot = JSON.stringify(joined.DS);
  filterKnowledgeTree(joined.DS, { onlyHighFrequency: true, onlyHighImportance: true });
  assert.equal(JSON.stringify(joined.DS), snapshot);
});

test('N: search finds real points with full chapter/section/subject context', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const results = searchKnowledgeTree(joined, '排序');
  assert.ok(results.length > 0, 'search 排序 should return results');
  assert.ok(
    results.some((result) => result.point.name.includes('排序')),
    'at least one result should match the query by name',
  );
  for (const result of results) {
    assert.ok(result.point.id && result.point.name, 'result must carry the atomic point');
    assert.ok(result.subjectCode && result.subjectName, 'result must carry subject context');
    assert.ok(result.chapterId && result.chapterName, 'result must carry chapter context');
    assert.ok(result.sectionId && result.sectionName, 'result must carry section context');
  }
});

test('O: search trims input and returns empty for blank or unmatched queries', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  assert.deepEqual(searchKnowledgeTree(joined, '   '), []);
  assert.deepEqual(searchKnowledgeTree(joined, ''), []);
  assert.deepEqual(searchKnowledgeTree(joined, '不存在的知识点XYZ'), []);
});

test('P: high-frequency rule uses recent5Frequency, never importance or estimatedFrequency', async () => {
  const source = await readFileSync(
    new URL('../packages/shared/src/knowledgeCatalog.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /recent5Frequency/, 'filter must consult recent5Frequency');
  assert.doesNotMatch(source, /estimatedFrequency/, 'filter must not derive frequency from estimatedFrequency');
});

test('Q: knowledge point index covers all 1149 atomic points with stable context', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const index = buildKnowledgePointIndex(joined);
  assert.equal(Object.keys(index).length, 1149);

  const spot = index['CO-C05-S03-P07'];
  assert.ok(spot, 'known atomic id should resolve');
  assert.equal(spot.point.id, 'CO-C05-S03-P07');
  assert.equal(spot.subjectCode, 'CO');
  assert.equal(spot.subjectName, '计算机组成原理');
  assert.equal(spot.chapterId, 'CO-C05');
  assert.equal(spot.sectionId, 'CO-C05-S03');
  assert.ok(spot.chapterName && spot.sectionName && spot.point.name, 'context should carry names');
});

test('R: prerequisite and related ids resolve to real names, unknown ids are ignored, duplicates deduped', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const index = buildKnowledgePointIndex(joined);
  const points = collectAllPoints(joined);

  const withPrereq = points.find((point) => point.prerequisites.length > 0);
  assert.ok(withPrereq, 'real data should contain a point with prerequisites');
  const prereqContexts = resolveKnowledgePointRefs(index, withPrereq.prerequisites);
  assert.equal(prereqContexts.length, withPrereq.prerequisites.length);
  for (const context of prereqContexts) {
    assert.ok(context.point.name, 'prerequisite must resolve to a real name');
    assert.ok(context.subjectCode && context.chapterName && context.sectionName);
  }

  const withRelated = points.find((point) => point.relatedPoints.length > 0);
  assert.ok(withRelated, 'real data should contain a point with related points');
  const relatedContexts = resolveKnowledgePointRefs(index, withRelated.relatedPoints);
  assert.equal(relatedContexts.length, withRelated.relatedPoints.length);
  for (const context of relatedContexts) {
    assert.ok(context.point.name, 'related point must resolve to a real name');
  }

  const mixed = resolveKnowledgePointRefs(index, [
    withPrereq.prerequisites[0],
    withPrereq.prerequisites[0],
    'UNKNOWN-NODE-ID',
    withRelated.relatedPoints[0],
    'UNKNOWN-NODE-ID-2',
  ]);
  assert.equal(mixed.length, 2, 'duplicates and unknown ids must be ignored while order is preserved');
  assert.equal(mixed[0].point.id, withPrereq.prerequisites[0]);
  assert.equal(mixed[1].point.id, withRelated.relatedPoints[0]);
});

test('S: resolver helpers never mutate the catalog or the id list', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinFrequencyEvidence(catalog, frequency.items);
  const snapshot = JSON.stringify(joined);
  const point = collectAllPoints(joined).find((item) => item.prerequisites.length > 0);
  const ids = [...point.prerequisites];
  const idsSnapshot = JSON.stringify(ids);
  const index = buildKnowledgePointIndex(joined);
  resolveKnowledgePointRefs(index, ids);
  assert.equal(JSON.stringify(joined), snapshot);
  assert.equal(JSON.stringify(ids), idsSnapshot);
});

test('T: chapter/section stats data is complete, unique and aligned with the real V2 tree', () => {
  assert.deepEqual(statsFile.meta.years, [2022, 2023, 2024, 2025, 2026]);

  const seenIds = new Set();
  for (const item of statsFile.stats) {
    assert.ok(!seenIds.has(item.nodeId), `duplicate stats id ${item.nodeId}`);
    seenIds.add(item.nodeId);
    for (const field of [
      'relatedQuestionCount',
      'primaryQuestionCount',
      'primaryScore',
      'yearCount',
      'avgRelatedQuestionsPerYear',
      'coverageRate',
    ]) {
      assert.equal(typeof item[field], 'number', `${item.nodeId}.${field} should be numeric`);
    }
  }

  const catalog = buildKnowledgeTree(tree.nodes);
  const chapterIds = new Set(['DS', 'CO', 'OS', 'CN'].flatMap((code) => catalog[code].chapters.map((chapter) => chapter.id)));
  const sectionIds = new Set(
    ['DS', 'CO', 'OS', 'CN'].flatMap((code) =>
      catalog[code].chapters.flatMap((chapter) => chapter.sections.map((section) => section.id)),
    ),
  );
  const statsIds = new Set(statsFile.stats.map((item) => item.nodeId));
  const chapterCount = statsFile.stats.filter((item) => item.nodeType === 'chapter').length;
  const sectionCount = statsFile.stats.filter((item) => item.nodeType === 'section').length;

  assert.equal(chapterCount, chapterIds.size, 'chapter stats count should match the tree');
  assert.equal(sectionCount, sectionIds.size, 'section stats count should match the tree');
  for (const item of statsFile.stats) {
    if (item.nodeType === 'chapter') assert.ok(chapterIds.has(item.nodeId), `unknown chapter stats id ${item.nodeId}`);
    if (item.nodeType === 'section') assert.ok(sectionIds.has(item.nodeId), `unknown section stats id ${item.nodeId}`);
  }
  for (const id of chapterIds) assert.ok(statsIds.has(id), `missing chapter stats ${id}`);
  for (const id of sectionIds) assert.ok(statsIds.has(id), `missing section stats ${id}`);
});

test('U: stats join reproduces the real chapter and section values exactly', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinChapterSectionStats(catalog, statsFile.stats);

  const chapter = joined.DS.chapters.find((item) => item.id === 'DS-C06');
  const rawChapter = statsFile.stats.find((item) => item.nodeId === 'DS-C06');
  assert.ok(chapter && rawChapter, 'spot-check chapter should exist');
  assert.deepEqual(chapter.stats, {
    relatedQuestionCount: rawChapter.relatedQuestionCount,
    primaryQuestionCount: rawChapter.primaryQuestionCount,
    primaryScore: rawChapter.primaryScore,
    yearCount: rawChapter.yearCount,
    avgRelatedQuestionsPerYear: rawChapter.avgRelatedQuestionsPerYear,
    coverageRate: rawChapter.coverageRate,
  });

  const section = chapter.sections.find((item) => item.id === 'DS-C06-S03');
  const rawSection = statsFile.stats.find((item) => item.nodeId === 'DS-C06-S03');
  assert.ok(section && rawSection, 'spot-check section should exist');
  assert.deepEqual(section.stats, {
    relatedQuestionCount: rawSection.relatedQuestionCount,
    primaryQuestionCount: rawSection.primaryQuestionCount,
    primaryScore: rawSection.primaryScore,
    yearCount: rawSection.yearCount,
    avgRelatedQuestionsPerYear: rawSection.avgRelatedQuestionsPerYear,
    coverageRate: rawSection.coverageRate,
  });
});

test('V: unknown stats ids never create ghost chapters or sections', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const joined = joinChapterSectionStats(catalog, [
    ...statsFile.stats,
    {
      nodeId: 'UNKNOWN-CHAPTER-ID',
      nodeType: 'chapter',
      subject: 'DS',
      name: '幽灵章',
      parentId: 'DS',
      atomicPointCount: 0,
      relatedQuestionCount: 0,
      primaryQuestionCount: 0,
      primaryScore: 0,
      years: [],
      yearCount: 0,
      avgRelatedQuestionsPerYear: 0,
      coverageRate: 0,
    },
    {
      nodeId: 'UNKNOWN-SECTION-ID',
      nodeType: 'section',
      subject: 'DS',
      name: '幽灵节',
      parentId: 'DS-C01',
      atomicPointCount: 0,
      relatedQuestionCount: 0,
      primaryQuestionCount: 0,
      primaryScore: 0,
      years: [],
      yearCount: 0,
      avgRelatedQuestionsPerYear: 0,
      coverageRate: 0,
    },
  ]);

  let chapterCount = 0;
  let sectionCount = 0;
  for (const subject of Object.values(joined)) {
    chapterCount += subject.chapters.length;
    for (const chapter of subject.chapters) sectionCount += chapter.sections.length;
  }
  assert.equal(chapterCount, 24, 'unknown stats ids must not add chapters');
  assert.equal(sectionCount, 119, 'unknown stats ids must not add sections');
});

test('W: nodes without stats keep stats === undefined without zero-filling', () => {
  const catalog = buildKnowledgeTree(tree.nodes);

  const withoutOneChapter = statsFile.stats.filter((item) => !(item.nodeType === 'chapter' && item.nodeId === 'DS-C01'));
  const joined = joinChapterSectionStats(catalog, withoutOneChapter);
  const missingChapter = joined.DS.chapters.find((chapter) => chapter.id === 'DS-C01');
  assert.equal(missingChapter.stats, undefined, 'missing chapter stats must stay undefined');

  const chaptersOnly = statsFile.stats.filter((item) => item.nodeType === 'chapter');
  const joinedSectionsMissing = joinChapterSectionStats(catalog, chaptersOnly);
  const firstSection = joinedSectionsMissing.DS.chapters[0].sections[0];
  assert.equal(firstSection.stats, undefined, 'missing section stats must stay undefined');
});

test('X: stats join never mutates the catalog or the stats items', () => {
  const catalog = buildKnowledgeTree(tree.nodes);
  const catalogSnapshot = JSON.stringify(catalog);
  const statsSnapshot = JSON.stringify(statsFile.stats);
  joinChapterSectionStats(catalog, statsFile.stats);
  assert.equal(JSON.stringify(catalog), catalogSnapshot, 'catalog must not be mutated');
  assert.equal(JSON.stringify(statsFile.stats), statsSnapshot, 'stats items must not be mutated');
});
