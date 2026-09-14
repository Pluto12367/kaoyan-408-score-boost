import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GRADE_ANCHORS,
  LOOP_LAYERS,
  validate,
  layerScore,
  layerLetter,
  computeScorecard,
} from '../scripts/audit-v13-scorecard.mjs';

const RUBRIC_PATH = resolve('docs/audit/v13-rubric.json');
const EVIDENCE_PATH = resolve('docs/audit/v13-evidence.json');

function loadReal() {
  const rubric = JSON.parse(readFileSync(RUBRIC_PATH, 'utf8'));
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  return { rubric, evidence };
}

function miniRubric() {
  return {
    version: 'test',
    scoring: { gradeAnchors: { ...GRADE_ANCHORS } },
    layers: [
      {
        id: 'diagnosis',
        name: 'L2',
        weight: 0.5,
        items: [
          { id: 'G1', name: 'a', priority: 'P0', criteria: { A: 'a', B: 'b', C: 'c', D: 'd' } },
          { id: 'G2', name: 'b', priority: 'P0', criteria: { A: 'a', B: 'b', C: 'c', D: 'd' } },
        ],
      },
      {
        id: 'training',
        name: 'L4',
        weight: 0.5,
        items: [
          { id: 'T1', name: 'c', priority: 'P0', criteria: { A: 'a', B: 'b', C: 'c', D: 'd' } },
          { id: 'T2', name: 'd', priority: 'P1', criteria: { A: 'a', B: 'b', C: 'c', D: 'd' } },
        ],
      },
    ],
  };
}

function grade(id, g) {
  return { [id]: { grade: g, rationale: `r-${id}`, citations: ['x.ts:1'], gap: '', roadmapRef: '—' } };
}

test('layerScore 等权均值', () => {
  assert.equal(layerScore(['A', 'B']), (1.0 + 0.6) / 2);
  assert.equal(layerScore(['C', 'D']), (0.25 + 0) / 2);
});

test('layerLetter 最近锚点、等距保守向下', () => {
  assert.equal(layerLetter(1.0), 'A');
  assert.equal(layerLetter(0.85), 'A');
  assert.equal(layerLetter(0.8), 'B'); // A/B 中点 -> 向下取 B
  assert.equal(layerLetter(0.6), 'B');
  assert.equal(layerLetter(0.425), 'C'); // B/C 中点 -> 向下取 C
  assert.equal(layerLetter(0.25), 'C');
  assert.equal(layerLetter(0.125), 'D'); // C/D 中点 -> 向下取 D
  assert.equal(layerLetter(0), 'D');
});

test('validate 拒绝缺失评级 / 非法等级 / 无证据引用', () => {
  const rubric = miniRubric();
  const bad1 = validate(rubric, { grades: { ...grade('G1', 'A'), ...grade('G2', 'B'), ...grade('T1', 'C') } });
  assert.equal(bad1.ok, false);
  assert.ok(bad1.errors.some((e) => e.includes('T2 未评级')));

  const bad2 = validate(rubric, {
    grades: { ...grade('G1', 'E'), ...grade('G2', 'B'), ...grade('T1', 'C'), ...grade('T2', 'D') },
  });
  assert.ok(bad2.errors.some((e) => e.includes('grade 非法')));

  const noCite = { G1: { grade: 'A', rationale: 'r', citations: [] } };
  const bad3 = validate(rubric, {
    grades: { ...noCite, ...grade('G2', 'B'), ...grade('T1', 'C'), ...grade('T2', 'D') },
  });
  assert.ok(bad3.errors.some((e) => e.includes('缺少代码级证据')));

  const badWeights = miniRubric();
  badWeights.layers[0].weight = 0.7;
  const bad4 = validate(badWeights, {
    grades: { ...grade('G1', 'A'), ...grade('G2', 'B'), ...grade('T1', 'C'), ...grade('T2', 'D') },
  });
  assert.ok(bad4.errors.some((e) => e.includes('权重之和')));
});

test('computeScorecard：P0 门禁在闭环层 P0 项 < B 时 FAIL，即使层等级为 B', () => {
  const rubric = miniRubric();
  const grades = { ...grade('G1', 'A'), ...grade('G2', 'B'), ...grade('T1', 'C'), ...grade('T2', 'D') };
  const card = computeScorecard(rubric, { grades });
  const trainingLayer = card.layers.find((l) => l.id === 'training');
  // T1=C, T2=D -> 层分 0.125 -> D；构造一个层等级 B 但 P0 低于 B 的场景：
  assert.equal(trainingLayer.letter, 'D');
  assert.equal(card.closedLoop.verdict, 'FAIL');
  assert.ok(card.closedLoop.failingP0.some((f) => f.itemId === 'T1'));

  const rubric2 = miniRubric();
  const grades2 = { ...grade('G1', 'A'), ...grade('G2', 'B'), ...grade('T1', 'B'), ...grade('T2', 'A') };
  const card2 = computeScorecard(rubric2, { grades: grades2 });
  assert.equal(card2.closedLoop.verdict, 'PASS');

  // 层等级 B（均值 0.625）但 P0 项 = C：层门禁过、P0 门禁必须 FAIL
  const rubric3 = miniRubric();
  const grades3 = { ...grade('G1', 'A'), ...grade('G2', 'C'), ...grade('T1', 'B'), ...grade('T2', 'A') };
  const card3 = computeScorecard(rubric3, { grades: grades3 });
  const diag = card3.layers.find((l) => l.id === 'diagnosis');
  assert.equal(diag.letter, 'B');
  assert.equal(card3.closedLoop.layerGate, true);
  assert.equal(card3.closedLoop.p0Gate, false);
  assert.equal(card3.closedLoop.verdict, 'FAIL');
});

test('真实 rubric + evidence：结构合法，闭环层与 P0 语义生效', () => {
  const { rubric, evidence } = loadReal();
  const v = validate(rubric, evidence);
  assert.equal(v.ok, true, `校验错误: ${v.errors.join('; ')}`);
  assert.equal(rubric.layers.reduce((s, l) => s + l.items.length, 0), 59);
  const card = computeScorecard(rubric, evidence);
  // 基线钉死（RULE-02 精神：评级有意变化时须同步更新此断言并说明理由）
  assert.equal(card.layers.every((l) => ['A', 'B', 'C', 'D'].includes(l.letter)), true);
  assert.equal(card.closedLoop.verdict, 'FAIL');
  assert.ok(card.closedLoop.failingP0.length >= 10, `P0 短板应 >= 10 项，实测 ${card.closedLoop.failingP0.length}`);
  assert.ok(card.v13Score > 0 && card.v13Score < 1);
  for (const l of card.layers) {
    assert.ok(LOOP_LAYERS.includes(l.id) || l.id === 'data');
  }
});
