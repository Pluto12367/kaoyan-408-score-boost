#!/usr/bin/env node
/**
 * V13 提分能力审计评分运行器。
 *
 * 输入：docs/audit/v13-rubric.json（评分口径）+ docs/audit/v13-evidence.json（逐项评级与证据）。
 * 输出：层分/层等级/加权 V13 总分/提分闭环判定 + markdown 基线报告（默认 docs/audit/v13-baseline-report.md）。
 *
 * 设计参考（open-source reference check，2026-09-14）：
 * - OpenSSF Scorecard：rubric 即数据、逐项评分附证据与整改位、加权总分之外另有策略门禁
 *   （https://github.com/ossf/scorecard）。
 * - Lighthouse scoring：类别权重 + 类内等权 + 锚点分档（https://github.com/GoogleChrome/lighthouse/blob/main/docs/scoring.md）。
 * 叠加本仓诚实规则（AGENTS.md RULE-05/06/11）：未知不伪造、评级必须引证据、任何输出不得声称为 Verified Score Gain。
 *
 * 用法：npm run audit:v13  （或 node scripts/audit-v13-scorecard.mjs [--evidence <path>] [--out <path>|none] [--quiet] [--check]）
 * 退出码：0 = 评分完成（闭环 FAIL 是审计发现，不是脚本错误）；1 = rubric/evidence 校验失败。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_RUBRIC = resolve(ROOT, 'docs/audit/v13-rubric.json');
const DEFAULT_EVIDENCE = resolve(ROOT, 'docs/audit/v13-evidence.json');
const DEFAULT_OUT = resolve(ROOT, 'docs/audit/v13-baseline-report.md');

export const GRADE_ANCHORS = { A: 1.0, B: 0.6, C: 0.25, D: 0 };
export const GRADE_ORDER = ['A', 'B', 'C', 'D'];
export const LOOP_LAYERS = ['diagnosis', 'decision', 'training', 'validation'];
const EPS = 1e-12;

function anchorIndex(grade) {
  const i = GRADE_ORDER.indexOf(grade);
  if (i < 0) throw new Error(`未知等级: ${grade}`);
  return i;
}

/** 校验 rubric 与 evidence 的结构完整性。返回 { ok, errors }。 */
export function validate(rubric, evidence) {
  const errors = [];
  if (!rubric || !Array.isArray(rubric.layers) || rubric.layers.length === 0) {
    errors.push('rubric.layers 缺失或为空');
    return { ok: false, errors };
  }
  const anchors = rubric.scoring?.gradeAnchors;
  if (!anchors) errors.push('rubric.scoring.gradeAnchors 缺失');
  else {
    for (const g of GRADE_ORDER) {
      if (anchors[g] !== GRADE_ANCHORS[g]) errors.push(`gradeAnchors.${g} = ${anchors[g]}，与运行器常量 ${GRADE_ANCHORS[g]} 不一致`);
    }
  }
  const weightSum = rubric.layers.reduce((s, l) => s + (l.weight ?? 0), 0);
  if (Math.abs(weightSum - 1) > 1e-9) errors.push(`层权重之和 = ${weightSum}，必须为 1`);
  const seenIds = new Set();
  for (const layer of rubric.layers) {
    if (!layer.id) errors.push('存在无 id 的层');
    if (seenIds.has(layer.id)) errors.push(`层 id 重复: ${layer.id}`);
    seenIds.add(layer.id);
    if (!Array.isArray(layer.items) || layer.items.length === 0) {
      errors.push(`层 ${layer.id} 无审计项`);
      continue;
    }
    for (const item of layer.items) {
      if (seenIds.has(item.id)) errors.push(`审计项 id 重复: ${item.id}`);
      seenIds.add(item.id);
      if (!['P0', 'P1'].includes(item.priority)) errors.push(`${item.id}.priority 非法: ${item.priority}`);
      for (const g of GRADE_ORDER) {
        if (!item.criteria?.[g]) errors.push(`${item.id} 缺少 criteria.${g}`);
      }
    }
  }
  for (const loopId of LOOP_LAYERS) {
    if (!seenIds.has(loopId) && !rubric.layers.some((l) => l.id === loopId)) errors.push(`闭环层缺失: ${loopId}`);
  }
  if (!evidence?.grades) {
    errors.push('evidence.grades 缺失');
    return { ok: errors.length === 0, errors };
  }
  for (const layer of rubric.layers) {
    for (const item of layer.items) {
      const g = evidence.grades[item.id];
      if (!g) {
        errors.push(`审计项 ${item.id} 未评级（UNGRADED 禁止，证据不足应评低档并写明理由）`);
        continue;
      }
      if (!GRADE_ORDER.includes(g.grade)) errors.push(`${item.id}.grade 非法: ${g.grade}`);
      if (!g.rationale || !String(g.rationale).trim()) errors.push(`${item.id} 缺少评级依据 rationale`);
      if (!Array.isArray(g.citations) || g.citations.length === 0) errors.push(`${item.id} 缺少代码级证据 citations`);
    }
  }
  const extra = Object.keys(evidence.grades).filter((id) => !seenIds.has(id));
  for (const id of extra) errors.push(`evidence 存在 rubric 之外的评级项: ${id}`);
  return { ok: errors.length === 0, errors };
}

/** 层分 = 层内各项 anchor 分均值（等权）。 */
export function layerScore(grades) {
  const values = grades.map((g) => GRADE_ANCHORS[g]);
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 层等级 = 距 anchor 最近者；等距时向下取（保守）。 */
export function layerLetter(score) {
  let best = GRADE_ORDER[0];
  for (const g of GRADE_ORDER) {
    const d = Math.abs(score - GRADE_ANCHORS[g]);
    const bestD = Math.abs(score - GRADE_ANCHORS[best]);
    if (d <= bestD + EPS) best = g; // 降序遍历，等距时后者（更低档）胜出
  }
  return best;
}

/** 汇总计算：层结果、加权总分、闭环判定（层门禁 + P0 门禁）。 */
export function computeScorecard(rubric, evidence) {
  const layers = rubric.layers.map((layer) => {
    const items = layer.items.map((item) => {
      const g = evidence.grades[item.id];
      return {
        ...item,
        grade: g.grade,
        score: GRADE_ANCHORS[g.grade],
        rationale: g.rationale,
        gap: g.gap ?? '',
        citations: g.citations ?? [],
        roadmapRef: g.roadmapRef ?? '—',
      };
    });
    const score = layerScore(items.map((i) => i.grade));
    const p0Items = items.filter((i) => i.priority === 'P0');
    return {
      id: layer.id,
      name: layer.name,
      weight: layer.weight,
      question: layer.question,
      score,
      letter: layerLetter(score),
      items,
      p0Total: p0Items.length,
      p0BelowB: p0Items.filter((i) => anchorIndex(i.grade) > anchorIndex('B')).length,
      inLoop: LOOP_LAYERS.includes(layer.id),
    };
  });
  const v13Score = layers.reduce((s, l) => s + l.weight * l.score, 0);
  const loopLayers = layers.filter((l) => l.inLoop);
  const layerGate = loopLayers.every((l) => anchorIndex(l.letter) <= anchorIndex('B'));
  const failingP0 = loopLayers.flatMap((l) =>
    l.items
      .filter((i) => i.priority === 'P0' && anchorIndex(i.grade) > anchorIndex('B'))
      .map((i) => ({ layerId: l.id, itemId: i.id, name: i.name, grade: i.grade, roadmapRef: i.roadmapRef })),
  );
  const closedLoop = {
    layerGate,
    p0Gate: failingP0.length === 0,
    verdict: layerGate && failingP0.length === 0 ? 'PASS' : 'FAIL',
    failingP0,
  };
  return { layers, v13Score, closedLoop };
}

function fmt(n, digits = 4) {
  return Number(n.toFixed(digits)).toString();
}

/** 渲染 markdown 基线报告。 */
export function renderReport(rubric, evidence, scorecard) {
  const { layers, v13Score, closedLoop } = scorecard;
  const anchorText = GRADE_ORDER.map((g) => `${g}=${GRADE_ANCHORS[g]}`).join(' / ');
  const lines = [];
  lines.push('# V13 提分能力审计 · 基线评分报告');
  lines.push('');
  lines.push('> **GENERATED FILE** — 由 `scripts/audit-v13-scorecard.mjs` 生成，勿手改。评级变化请改 `docs/audit/v13-evidence.json` 后重跑 `npm run audit:v13`。');
  lines.push('');
  lines.push(`- 审计日期：${evidence.auditDate}　分支：\`${evidence.branch}\`　HEAD：\`${evidence.head}\``);
  lines.push(`- 评级人/方式：${evidence.grader}`);
  lines.push(`- 评分口径：\`docs/audit/v13-rubric.json\` v${rubric.version}（anchor：${anchorText}；层内等权；层权重 ${rubric.layers.map((l) => `${l.id} ${l.weight}`).join(' / ')}）`);
  lines.push(`- 免责（RULE-11）：${evidence.disclaimer}`);
  lines.push('');
  lines.push('## 1. 结论');
  lines.push('');
  lines.push(`- **V13 加权总分 = ${fmt(v13Score)} / 1.00**（平均分会掩盖短板，以下闭环判定优先于总分）`);
  const loopVerdictText = closedLoop.verdict === 'PASS' ? '**具备**（两门禁均过）' : '**不具备**';
  lines.push(`- **提分闭环完整度 = ${closedLoop.verdict}** —— ${loopVerdictText}。层门禁（诊断/决策/训练/验证每层 ≥ B）：${closedLoop.layerGate ? 'PASS' : 'FAIL'}；P0 门禁（闭环层内任意 P0 项 < B 即失败）：${closedLoop.p0Gate ? 'PASS' : `FAIL（${closedLoop.failingP0.length} 项 P0 低于 B）`}。`);
  lines.push('');
  lines.push('| 层 | 权重 | 层分 | 等级 | P0 达标（≥B / 总） | 在闭环内 |');
  lines.push('|---|---:|---:|:---:|:---:|:---:|');
  for (const l of layers) {
    lines.push(`| ${l.name} | ${l.weight} | ${fmt(l.score)} | **${l.letter}** | ${l.p0Total - l.p0BelowB} / ${l.p0Total} | ${l.inLoop ? '是' : '否（供数层）'} |`);
  }
  lines.push('');
  if (closedLoop.failingP0.length > 0) {
    lines.push('**闭环 P0 短板清单（评级 < B 的 P0 项，即『提分闭环 = FAIL』的直接原因）**：');
    lines.push('');
    lines.push('| 审计项 | 层 | 等级 | 路线图归属 |');
    lines.push('|---|---|:---:|:---:|');
    for (const f of closedLoop.failingP0) {
      lines.push(`| ${f.itemId} ${f.name} | ${f.layerId} | ${f.grade} | ${f.roadmapRef} |`);
    }
    lines.push('');
  }
  if (evidence.hypothesis) {
    const h = evidence.hypothesis;
    const actual = Object.fromEntries(layers.map((l) => [l.id, l.letter + (l.score < 0.55 ? '（低位）' : '')]));
    lines.push('### 与 Owner 初始假设的差异');
    lines.push('');
    lines.push(`假设：Data ${h.data} / Diagnosis ${h.diagnosis} / Decision ${h.decision} / Training ${h.training} / Validation ${h.validation}。实测：Data ${actual.data} / Diagnosis ${actual.diagnosis} / Decision ${actual.decision} / Training ${actual.training} / Validation ${actual.validation}。`);
    lines.push('');
    lines.push('差异解释：Training/Validation 的字母档比假设高，是因为大量『工具/管线已建成』满足 B 档下限（B = 底层能力存在但闭环/证据不足）；但按 P0 门禁看，验证层 11 个 P0 项中 4 项 < B、训练层 T2 刻意训练 = C——『结构在、证据无、处方缺』的实质与 Owner 直觉一致。字母总分不应掩盖这一点。');
    lines.push('');
  }
  lines.push('## 2. 逐层明细');
  for (const l of layers) {
    lines.push('');
    lines.push(`### ${l.name}（权重 ${l.weight}，层分 ${fmt(l.score)}，等级 ${l.letter}）`);
    lines.push('');
    lines.push(`> 核心问题：${l.question}`);
    lines.push('');
    lines.push('| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |');
    lines.push('|---|---|:---:|:---:|---|');
    for (const i of l.items) {
      lines.push(`| ${i.id} | ${i.name} | ${i.priority} | ${i.grade} | ${i.rationale} |`);
    }
    lines.push('');
    lines.push('证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：');
    for (const i of l.items) {
      lines.push(`- **${i.id} ${i.name}（${i.grade}）** gap：${i.gap || '—'}｜roadmapRef：${i.roadmapRef}｜证据：${i.citations.join('；')}`);
    }
  }
  lines.push('');
  lines.push('## 3. 判定规则（与 rubric 一致）');
  lines.push('');
  lines.push('- 项分：A=1.0 / B=0.6 / C=0.25 / D=0；层分 = 项分均值；层等级 = 距 anchor 最近者（等距向下取，保守）。');
  lines.push(`- V13 总分 = Σ(层权重 × 层分) = ${layers.map((l) => `${l.weight}×${fmt(l.score)}`).join(' + ')} = ${fmt(v13Score)}。`);
  lines.push('- 提分闭环 = 诊断→决策→训练→验证四层链路：层门禁（每层 ≥ B）与 P0 门禁（闭环层内任意 P0 项 < B 即 FAIL）须同时满足。');
  lines.push('- 诚实规则：『代码存在但生产样本=0/开关 OFF』按 B 上限评；证据不足按低档评；本报告不构成任何 Verified Score Gain 声明（RULE-11）。');
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { rubric: DEFAULT_RUBRIC, evidence: DEFAULT_EVIDENCE, out: DEFAULT_OUT, quiet: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--rubric') args.rubric = resolve(argv[(i += 1)]);
    else if (a === '--evidence') args.evidence = resolve(argv[(i += 1)]);
    else if (a === '--out') args.out = argv[(i += 1)];
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--check') args.check = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rubric = JSON.parse(readFileSync(args.rubric, 'utf8'));
  const evidence = JSON.parse(readFileSync(args.evidence, 'utf8'));
  const { ok, errors } = validate(rubric, evidence);
  if (!ok) {
    console.error('RUBRIC/EVIDENCE 校验失败：');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const scorecard = computeScorecard(rubric, evidence);
  if (!args.quiet) {
    console.log(`V13 提分能力审计（${evidence.auditDate}，HEAD ${evidence.head.slice(0, 8)}）`);
    for (const l of scorecard.layers) {
      console.log(`  ${l.name}: ${l.score.toFixed(4)} -> ${l.letter}  (P0>=B: ${l.p0Total - l.p0BelowB}/${l.p0Total})`);
    }
    console.log(`  V13 总分: ${scorecard.v13Score.toFixed(4)} / 1.00`);
    console.log(`  提分闭环: ${scorecard.closedLoop.verdict}（层门禁 ${scorecard.closedLoop.layerGate ? 'PASS' : 'FAIL'} / P0 门禁 ${scorecard.closedLoop.p0Gate ? 'PASS' : 'FAIL'}）`);
  }
  if (args.check) {
    console.log('--check：仅校验与计算，不写报告。');
    return;
  }
  if (args.out === 'none') return;
  const report = renderReport(rubric, evidence, scorecard);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, report, 'utf8');
  if (!args.quiet) console.log(`报告已写入: ${args.out}`);
}

const isDirectRun = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isDirectRun) main();
