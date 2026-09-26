#!/usr/bin/env node
// V14 — 2009-2021 legacy exam-mapping bundle generator.
//
// Inputs (all in-repo, Owner-approved):
//   • kaoyan-408-content-starter/imports/real-exam-YYYY-source.json  (13 years,
//     题面原文+官方答案字母 from the public source pages)
//   • kaoyan-408-content-starter/imports/real-exam-2009-2021-tag-mapping-draft.csv
//     (CONFIRMED tag→node table, reviewedBy=zhoujiale(Owner) 2026-09-26)
//   • ESSAY_MAP below: per-essay PRIMARY (+SECONDARY) mapped by the agent from
//     essay stems, confirmed by Owner in the same approval (2026-09-26「确认」)
//
// Output: data/408/exam-mapping/408-YYYY-question-knowledge-map.json matching
// the verified 2022-2026 bundle shape so downstream (importer cross-check,
// scaffold generator, audit, seed) works unchanged.
//
// Score policy (RULE-05/06 honest state, Owner decision 2026-09-26):
//   • MCQ = 2 (408 structure fact, every year)        → scoreStatus "verified"
//   • essay = ESSAY_SCORES below                      → scoreStatus "observed-official-transcript"
//     （公开真题转录原文标注且多源一致）或 "stipulated-draft"
//     （D-5 草稿拟定值 = 同年 rubric-v1 totalPoints，待官方核验；PROXY，非 OBSERVED）。
//     未走完官方搜证的年份按 Owner 2026-09-26 决定先用拟定值定价；后续核验只做版本化修订。
// mappingConfidence: 0.9 tag-high / 0.75 tag-medium-low / 1.0 essay-manual.
// sourceStatus: "tag-derived-confirmed" (MCQ) / "essay-manual-mapped" (essay).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const IMPORTS_DIR = join(process.cwd(), 'kaoyan-408-content-starter', 'imports');
const OUT_DIR = join(process.cwd(), 'data', '408', 'exam-mapping');
const YEARS = Array.from({ length: 13 }, (_, index) => 2009 + index);

const SUBJECT_CODE = { 数据结构: 'DS', 组成原理: 'CO', 操作系统: 'OS', 计算机网络: 'CN' };

/**
 * 91 道大题逐题映射（代理从题干判定，Owner 2026-09-26 随标签表一并确认）。
 * 形式：'YYYY-QNN|PRIMARY|SECONDARY(可空,| 分隔多个)'
 */
const ESSAY_MAP = `
2009-Q41|DS-C05-S05-P02|DS-C05-S05-P05
2009-Q42|DS-C02-S03-P18|DS-C02-S03-P05
2009-Q43|CO-C06-S03-P02|CO-C01-S02-P09
2009-Q44|CO-C05-S03-P06|CO-C05-S03-P07
2009-Q45|OS-C02-S05-P08|OS-C02-S04-P20
2009-Q46|OS-C03-S03-P08|OS-C03-S05-P04
2009-Q47|CN-C04-S07-P08|CN-C06-S02-P08
2010-Q41|DS-C06-S08-P06|DS-C06-S08-P12
2010-Q42|DS-C02-S04-P05|DS-C02-S03-P09
2010-Q43|CO-C04-S03-P07|CO-C04-S02-P07
2010-Q44|CO-C03-S05-P03|CO-C03-S06-P08
2010-Q45|OS-C05-S03-P08|OS-C04-S03-P05
2010-Q46|OS-C03-S05-P09|OS-C03-S05-P14
2010-Q47|CN-C03-S04-P13|CN-C03-S04-P12
2011-Q41|DS-C05-S02-P01|DS-C05-S06-P02
2011-Q42|DS-C02-S04-P05|DS-C06-S03-P04
2011-Q43|CO-C02-S03-P05|CO-C02-S02-P06
2011-Q44|CO-C03-S05-P03|CO-C03-S06-P08
2011-Q45|OS-C02-S05-P08|OS-C02-S04-P20
2011-Q46|OS-C04-S01-P12|OS-C04-S01-P16
2011-Q47|CN-C03-S05-P06|CN-C06-S05-P13
2012-Q41|DS-C07-S06-P05|DS-C07-S06-P03
2012-Q42|DS-C02-S03-P17|DS-C02-S03-P18
2012-Q43|CO-C03-S05-P17|CO-C03-S05-P03
2012-Q44|CO-C02-S01-P07|CO-C03-S05-P03
2012-Q45|OS-C03-S05-P06|OS-C03-S05-P04
2012-Q46|OS-C04-S01-P17|OS-C04-S01-P04
2012-Q47|CN-C05-S04-P06|CN-C05-S03-P02
2013-Q41|DS-C02-S04-P05|DS-C01-S02-P04
2013-Q42|DS-C06-S01-P05|DS-C06-S02-P04
2013-Q43|CO-C03-S03-P10|CO-C01-S02-P08
2013-Q44|CO-C05-S01-P10|CO-C04-S02-P07
2013-Q45|OS-C02-S04-P20|OS-C02-S04-P03
2013-Q46|OS-C03-S03-P09|OS-C03-S03-P06
2013-Q47|CN-C04-S07-P08|CN-C04-S05-P02
2014-Q41|DS-C04-S04-P01|DS-C04-S02-P14
2014-Q42|CN-C04-S05-P07|CN-C04-S02-P05
2014-Q43|CN-C04-S03-P13|CN-C04-S03-P10
2014-Q44|CO-C05-S06-P01|CO-C01-S02-P08
2014-Q45|OS-C03-S05-P03|CO-C03-S05-P16
2014-Q46|OS-C04-S01-P13|OS-C04-S01-P16
2014-Q47|OS-C02-S05-P01|OS-C02-S04-P20
2015-Q41|DS-C02-S04-P03|DS-C02-S03-P08
2015-Q42|DS-C05-S02-P01|DS-C05-S01-P10
2015-Q43|CO-C05-S03-P02|CO-C05-S03-P07
2015-Q44|CO-C05-S03-P07|CO-C05-S04-P01
2015-Q45|OS-C02-S05-P08|OS-C02-S04-P20
2015-Q46|OS-C03-S03-P09|OS-C03-S03-P06
2015-Q47|CN-C04-S03-P19|CN-C06-S05-P13
2016-Q41|CN-C03-S06-P08|CN-C04-S03-P19
2016-Q42|DS-C04-S01-P90|DS-C04-S01-P02
2016-Q43|DS-C02-S04-P05|DS-C07-S03-P04
2016-Q44|CO-C06-S03-P09|CO-C01-S02-P08
2016-Q45|CO-C03-S06-P11|CO-C03-S05-P05
2016-Q46|OS-C02-S03-P11|OS-C02-S03-P15
2016-Q47|OS-C04-S01-P15|OS-C04-S03-P05
2017-Q41|DS-C04-S02-P12|DS-C04-S02-P16
2017-Q42|DS-C05-S04-P02|DS-C05-S04-P01
2017-Q43|CO-C04-S06-P03|CO-C02-S02-P14
2017-Q44|CO-C04-S06-P02|CO-C04-S03-P07
2017-Q45|OS-C03-S03-P09|OS-C03-S03-P06
2017-Q46|OS-C02-S04-P18|OS-C02-S04-P03
2017-Q47|CN-C03-S03-P09|CN-C03-S03-P16
2018-Q41|DS-C02-S04-P05|DS-C01-S02-P08
2018-Q42|DS-C05-S04-P04|DS-C05-S04-P01
2018-Q43|CO-C06-S03-P09|CO-C01-S02-P08
2018-Q44|CO-C03-S06-P11|CO-C03-S05-P05
2018-Q45|OS-C03-S03-P09|OS-C03-S03-P03
2018-Q46|OS-C04-S01-P17|OS-C04-S01-P04
2018-Q47|CN-C04-S03-P23|CN-C04-S03-P10
2019-Q41|DS-C02-S03-P18|DS-C02-S03-P09
2019-Q42|DS-C03-S02-P07|DS-C03-S02-P08
2019-Q43|OS-C02-S05-P06|OS-C02-S04-P20
2019-Q44|OS-C05-S03-P08|OS-C05-S03-P04
2019-Q45|CO-C04-S06-P03|CO-C05-S06-P01
2019-Q46|CO-C03-S05-P05|OS-C03-S03-P02
2019-Q47|CN-C03-S06-P08|CN-C03-S06-P04
2020-Q41|DS-C02-S04-P05|DS-C01-S02-P08
2020-Q42|DS-C04-S04-P04|DS-C04-S04-P02
2020-Q43|CO-C02-S03-P06|CO-C02-S02-P06
2020-Q44|CO-C03-S05-P05|CO-C03-S05-P08
2020-Q45|OS-C02-S05-P08|OS-C02-S04-P20
2020-Q46|OS-C03-S05-P03|OS-C03-S03-P09
2020-Q47|CN-C04-S07-P08|CN-C04-S03-P19
2021-Q41|DS-C05-S03-P09|DS-C05-S01-P10
2021-Q42|DS-C07-S07-P04|DS-C07-S01-P02
2021-Q43|CO-C04-S02-P07|CO-C04-S03-P04
2021-Q44|OS-C03-S03-P07|CO-C03-S06-P09
2021-Q45|OS-C02-S04-P15|OS-C02-S04-P22
2021-Q46|OS-C01-S05-P01|OS-C05-S03-P02
2021-Q47|CN-C04-S03-P17|CN-C03-S06-P05
`;

// 两道无标签选择题的人工映射（Owner 确认链同标签表，2026-09-26）。
const QUESTION_OVERRIDES = new Map([
  ['2012-Q16', { primary: 'CO-C03-S02-P07', secondary: ['CO-C03-S02-P06'], confidence: 0.9, sourceStatus: 'question-manual-mapped' }],
  ['2015-Q13', { primary: 'CO-C02-S01-P07', secondary: ['CO-C02-S01-P09'], confidence: 0.9, sourceStatus: 'question-manual-mapped' }],
]);

/**
 * 91 道大题分值表（Q41–Q47 顺序）。值 = [score, status]：
 *   observed  公开真题转录原文分值标注且多源一致（知乎「考研408导论」各年文章
 *             "41.（X分）" 原文 + csgraduates 解析分项 2009 Q41=4+6/Q42=满分15/
 *             Q43=分项合计8 + hhkaobo 2009 分值分配文；证据摘录见
 *             imports/essay-score-table.json 与 current-sprint 账本）。
 *   stipulated D-5 草稿拟定值（= 同年草稿 rubric-v1 totalPoints；PROXY）。
 * 2009 全部观测覆盖（[10,15,8,13,7,8,9]，Σ=70 与卷面一致）；2010 观测 41=10/42=13、
 * 2011 观测 41=8，其余保持拟定——导入器年度 Σ=70 硬门禁下，观测分差在拟定值集合内
 * 吸收（2010 Q43 11→10、2011 Q42 13→14，均 stipulated、无官方依据、显式留痕），
 * 13 年年合计均为 70。Owner 决定（2026-09-26）：跳过对 2012-2021 的进一步搜证，先按拟定值定价。
 */
const ESSAY_SCORES = {
  2009: { 41: [10, 'observed'], 42: [15, 'observed'], 43: [8, 'observed'], 44: [13, 'observed'], 45: [7, 'observed'], 46: [8, 'observed'], 47: [9, 'observed'] },
  2010: { 41: [10, 'observed'], 42: [13, 'observed'], 43: [10, 'stipulated'], 44: [13, 'stipulated'], 45: [8, 'stipulated'], 46: [8, 'stipulated'], 47: [8, 'stipulated'] },
  2011: { 41: [8, 'observed'], 42: [14, 'stipulated'], 43: [13, 'stipulated'], 44: [13, 'stipulated'], 45: [8, 'stipulated'], 46: [6, 'stipulated'], 47: [8, 'stipulated'] },
  2012: { 41: [9, 'stipulated'], 42: [13, 'stipulated'], 43: [10, 'stipulated'], 44: [13, 'stipulated'], 45: [8, 'stipulated'], 46: [8, 'stipulated'], 47: [9, 'stipulated'] },
  2013: { 41: [13, 'stipulated'], 42: [9, 'stipulated'], 43: [11, 'stipulated'], 44: [13, 'stipulated'], 45: [7, 'stipulated'], 46: [9, 'stipulated'], 47: [8, 'stipulated'] },
  2014: { 41: [13, 'stipulated'], 42: [9, 'stipulated'], 43: [9, 'stipulated'], 44: [13, 'stipulated'], 45: [8, 'stipulated'], 46: [9, 'stipulated'], 47: [9, 'stipulated'] },
  2015: { 41: [13, 'stipulated'], 42: [13, 'stipulated'], 43: [9, 'stipulated'], 44: [13, 'stipulated'], 45: [7, 'stipulated'], 46: [9, 'stipulated'], 47: [6, 'stipulated'] },
  2016: { 41: [9, 'stipulated'], 42: [8, 'stipulated'], 43: [13, 'stipulated'], 44: [9, 'stipulated'], 45: [13, 'stipulated'], 46: [8, 'stipulated'], 47: [10, 'stipulated'] },
  2017: { 41: [13, 'stipulated'], 42: [8, 'stipulated'], 43: [14, 'stipulated'], 44: [10, 'stipulated'], 45: [8, 'stipulated'], 46: [9, 'stipulated'], 47: [8, 'stipulated'] },
  2018: { 41: [13, 'stipulated'], 42: [9, 'stipulated'], 43: [9, 'stipulated'], 44: [14, 'stipulated'], 45: [8, 'stipulated'], 46: [9, 'stipulated'], 47: [8, 'stipulated'] },
  2019: { 41: [13, 'stipulated'], 42: [9, 'stipulated'], 43: [7, 'stipulated'], 44: [7, 'stipulated'], 45: [8, 'stipulated'], 46: [13, 'stipulated'], 47: [13, 'stipulated'] },
  2020: { 41: [13, 'stipulated'], 42: [8, 'stipulated'], 43: [13, 'stipulated'], 44: [13, 'stipulated'], 45: [6, 'stipulated'], 46: [9, 'stipulated'], 47: [8, 'stipulated'] },
  2021: { 41: [13, 'stipulated'], 42: [13, 'stipulated'], 43: [12, 'stipulated'], 44: [9, 'stipulated'], 45: [8, 'stipulated'], 46: [8, 'stipulated'], 47: [7, 'stipulated'] },
};

function parseEssayMap() {
  const map = new Map();
  for (const line of ESSAY_MAP.trim().split('\n')) {
    const [id, primary, secondary] = line.split('|');
    map.set(id, { primary, secondary: (secondary ?? '').split('|').filter(Boolean) });
  }
  return map;
}

function loadConfirmedTagTable() {
  const csv = readFileSync(join(IMPORTS_DIR, 'real-exam-2009-2021-tag-mapping-draft.csv'), 'utf8');
  const rows = csv.split('\n').slice(1).filter(Boolean);
  const table = new Map();
  for (const row of rows) {
    const cells = row.match(/"([^"]*)"/g).map((cell) => cell.slice(1, -1));
    const [tag, , primary, , , confidence, shortlist, status] = cells;
    if (status !== 'CONFIRMED') throw new Error(`tag "${tag}" is ${status}, not CONFIRMED — run the approval step first`);
    const shortlistNodes = shortlist.split(' ').filter(Boolean);
    table.set(tag, { primary, confidence, shortlistNodes });
  }
  return table;
}

function main() {
  const tagTable = loadConfirmedTagTable();
  const essayMap = parseEssayMap();
  let generated = 0;

  for (const year of YEARS) {
    const source = JSON.parse(readFileSync(join(IMPORTS_DIR, `real-exam-${year}-source.json`), 'utf8'));
    const questions = [];
    const warnings = [];

    for (const q of source.questions) {
      const isMcq = q.kind === 'mcq';
      const subject = SUBJECT_CODE[(q.subject ?? '').replace(/-\d+$/, '')] ?? (q.subject ?? '').slice(0, 2);
      const id = `408-${year}-Q${String(q.questionNo).padStart(2, '0')}`;

      let primary;
      let secondary = [];
      let mappingConfidence;
      let sourceStatus;
      if (isMcq) {
        const tags = q.tags ?? [];
        const override = QUESTION_OVERRIDES.get(`${year}-Q${q.questionNo}`);
        const resolved = tags.map((tag) => tagTable.get(tag)).filter(Boolean);
        if (override) {
          primary = override.primary;
          secondary = override.secondary;
          mappingConfidence = override.confidence;
          sourceStatus = override.sourceStatus;
        } else if (resolved.length === 0) {
          warnings.push(`${id}: no confirmed tag mapping (tags: ${tags.join('/') || 'none'}) — skipped`);
          continue;
        } else {
          primary = resolved[0].primary;
          secondary = resolved.slice(1, 3).map((entry) => entry.primary);
          mappingConfidence = resolved[0].confidence === 'high' ? 0.9 : 0.75;
          sourceStatus = 'tag-derived-confirmed';
        }
      } else {
        const mapped = essayMap.get(`${year}-Q${q.questionNo}`);
        if (!mapped) {
          warnings.push(`${id}: essay not in ESSAY_MAP — skipped`);
          continue;
        }
        primary = mapped.primary;
        secondary = mapped.secondary;
        mappingConfidence = 1;
        sourceStatus = 'essay-manual-mapped';
      }

      const score = isMcq ? 2 : ESSAY_SCORES[year][q.questionNo][0];
      const essayScoreStatus = isMcq ? null : ESSAY_SCORES[year][q.questionNo][1];
      questions.push({
        id,
        exam: '408',
        year,
        questionNo: q.questionNo,
        subject,
        score,
        questionType: isMcq ? '选择题' : '综合题',
        summary: (q.stem ?? '').replace(/\s+/g, ' ').slice(0, 80),
        primaryKnowledgePointId: primary,
        secondaryKnowledgePointIds: secondary,
        mappingConfidence,
        isCrossSubject: secondary.some((node) => node.slice(0, 2) !== primary.slice(0, 2)),
        unmappedConcepts: [],
        sourceStatus,
        scoreStatus: isMcq ? 'verified' : essayScoreStatus === 'observed' ? 'observed-official-transcript' : 'stipulated-draft',
        scoreConfidence: isMcq ? 1 : null,
      });
    }

    const mcqCount = questions.filter((question) => question.questionType === '选择题').length;
    const bundle = {
      meta: {
        title: `408真题—知识点映射：${year}`,
        version: 'v1.0',
        generatedAt: new Date().toISOString().slice(0, 10),
        examYear: year,
        questionCount: questions.length,
        totalScore: 150,
        copyrightNote: '仅保存题号、分值、自写摘要与知识点映射；题面原文另存 source JSON（Owner D-1 批准口径）。',
        scoreNote: '选择题 2 分（卷面结构事实）；综合题见逐题 score/scoreStatus：observed-official-transcript=公开转录原文标注（多源一致），stipulated-draft=D-5 草稿拟定值待官方核验（Owner 2026-09-26 决定先定价后核验）。',
        sources: [{ name: `计算机考研杂货铺 ${year}年408真题`, url: `https://www.csgraduates.com/study_methods/408quiz/${year}/`, role: '题面与官方答案来源' }],
      },
      questions,
    };
    writeFileSync(join(OUT_DIR, `408-${year}-question-knowledge-map.json`), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    generated += 1;
    console.log(`${year}: ${questions.length} questions (mcq ${mcqCount}, essay ${questions.length - mcqCount}) → 408-${year}-question-knowledge-map.json`);
    for (const warning of warnings) console.warn(`  ⚠ ${warning}`);
  }
  console.log(`\nGenerated ${generated} legacy bundles.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
