import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKnowledgeCatalogFirstScreenHighlights,
} from '../packages/shared/dist/index.js';

function point(id, name, overrides = {}) {
  return {
    id,
    name,
    subject: 'DS',
    order: overrides.order ?? 1,
    importance: overrides.importance ?? 3,
    difficulty: overrides.difficulty ?? 3,
    prerequisites: [],
    relatedPoints: [],
    evidence: overrides.evidence ?? null,
  };
}

function subject(points) {
  return {
    code: 'DS',
    name: '数据结构',
    chapters: [
      {
        id: 'DS-01',
        name: '线性表',
        order: 1,
        sections: [
          {
            id: 'DS-01-01',
            name: '顺序表与链表',
            order: 1,
            points,
          },
        ],
      },
    ],
  };
}

test('first-screen highlights prioritize weak, high-frequency and unfinished quest points separately', () => {
  const highlights = buildKnowledgeCatalogFirstScreenHighlights({
    subject: subject([
      point('DS-weak', '链表边界条件', {
        importance: 5,
        evidence: { recent3Frequency: 2, recent5Frequency: 3, allTimeEvidence: 8, trendDirection: 'stable', trendDelta: 0, evidenceConfidence: 'high' },
      }),
      point('DS-hot', '排序复杂度比较', {
        importance: 5,
        difficulty: 4,
        evidence: { recent3Frequency: 4, recent5Frequency: 6, allTimeEvidence: 12, trendDirection: 'rising', trendDelta: 2, evidenceConfidence: 'high' },
      }),
      point('DS-quest', '栈和队列应用', {
        importance: 4,
        evidence: { recent3Frequency: 1, recent5Frequency: 2, allTimeEvidence: 5, trendDirection: 'stable', trendDelta: 0, evidenceConfidence: 'medium' },
      }),
      point('DS-mastered', '数组存储结构', {
        importance: 5,
        evidence: { recent3Frequency: 5, recent5Frequency: 7, allTimeEvidence: 13, trendDirection: 'rising', trendDelta: 1, evidenceConfidence: 'high' },
      }),
    ]),
    masteryById: {
      'DS-weak': { status: 'weak', mastery: 0.24, attempts: 4, questStatus: 'in_progress' },
      'DS-hot': { status: 'untouched', mastery: 0, attempts: 0, questStatus: 'not_started' },
      'DS-quest': { status: 'review', mastery: 0.55, attempts: 2, questStatus: 'in_progress' },
      'DS-mastered': { status: 'mastered', mastery: 0.86, attempts: 8, questStatus: 'passed' },
    },
  });

  assert.deepEqual(
    highlights.map((item) => [item.kind, item.point.id, item.title, item.statusLabel]),
    [
      ['weak', 'DS-weak', '薄弱优先', '薄弱'],
      ['highFrequency', 'DS-hot', '高频考点', '未学习'],
      ['quest', 'DS-quest', '闯关未完成', '进行中'],
    ],
  );
  assert.equal(highlights[0].reason, '掌握度 24% · 已练 4 次');
  assert.equal(highlights[1].reason, '近5年 6 次 · 重要度 5/5');
  assert.equal(highlights[2].reason, '闯关进行中 · 掌握度 55%');
  assert.deepEqual(
    highlights.map((item) => [item.kind, item.actionType, item.actionLabel]),
    [
      ['weak', 'inspect', '查看考点建议'],
      ['highFrequency', 'exam', '看真题命中'],
      ['quest', 'quest', '打开闯关入口'],
    ],
  );
  assert.ok(highlights.every((item) => item.actionHint.length > 0));
});

test('first-screen highlights fall back to useful high-frequency points when a subject has no mastery data', () => {
  const highlights = buildKnowledgeCatalogFirstScreenHighlights({
    subject: subject([
      point('DS-hot-a', '图的遍历', {
        importance: 5,
        evidence: { recent3Frequency: 3, recent5Frequency: 5, allTimeEvidence: 11, trendDirection: 'stable', trendDelta: 0, evidenceConfidence: 'high' },
      }),
      point('DS-hot-b', '最短路径', {
        importance: 5,
        evidence: { recent3Frequency: 2, recent5Frequency: 4, allTimeEvidence: 9, trendDirection: 'stable', trendDelta: 0, evidenceConfidence: 'high' },
      }),
      point('DS-hot-c', '查找判定树', {
        importance: 4,
        evidence: { recent3Frequency: 2, recent5Frequency: 3, allTimeEvidence: 7, trendDirection: 'stable', trendDelta: 0, evidenceConfidence: 'medium' },
      }),
    ]),
    masteryById: {},
  });

  assert.deepEqual(
    highlights.map((item) => [item.kind, item.point.id]),
    [
      ['weak', 'DS-hot-a'],
      ['highFrequency', 'DS-hot-b'],
      ['quest', 'DS-hot-c'],
    ],
  );
});

test('weak first-screen fallback never recommends a mastered point when unmastered points exist', () => {
  const highlights = buildKnowledgeCatalogFirstScreenHighlights({
    subject: subject([
      point('DS-mastered-in-progress', '线性表定义', {
        importance: 3,
        evidence: { recent3Frequency: 1, recent5Frequency: 1, allTimeEvidence: 1, trendDirection: 'cold', trendDelta: 0, evidenceConfidence: 'medium' },
      }),
      point('DS-unlearned-hot', '哈夫曼树构造', {
        importance: 5,
        evidence: { recent3Frequency: 4, recent5Frequency: 5, allTimeEvidence: 12, trendDirection: 'rising', trendDelta: 2, evidenceConfidence: 'high' },
      }),
    ]),
    masteryById: {
      'DS-mastered-in-progress': {
        status: 'mastered',
        mastery: 0.83,
        attempts: 129,
        questStatus: 'in_progress',
      },
    },
  });

  assert.equal(highlights[0].kind, 'weak');
  assert.equal(highlights[0].point.id, 'DS-unlearned-hot');
  assert.notEqual(highlights[0].statusLabel, '已掌握');
});
