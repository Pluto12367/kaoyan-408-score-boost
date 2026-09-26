#!/usr/bin/env node
// V14-P0 R2 — real-exam source fetcher (题面 acquisition; design §13 D-1 posture).
//
// Fetches the public 2026 408 paper page cited by the verified exam-mapping
// bundle (计算机考研杂货铺, data/408/exam-mapping/408-2026-…meta.sources) and
// extracts ONLY the public exam material: stem, options, official answer
// letter. The site's own analysis text is deliberately NOT extracted —
// analyses and traps for this repo are authored originally in this repo
// (large-question guide §7 red line: no verbatim third-party analysis).
//
// Output: kaoyan-408-content-starter/imports/real-exam-<year>-source.json
//   { fetchedAt, sourceUrl, questions: [{ questionNo, subject, kind,
//     stem, options: {A..D}, answer|null }] }
//
// Usage: node scripts/fetch-real-exam-source.mjs --year <YYYY> [--url <override>]
//   (reads the fetched page HTML on stdin; the fetch is a plain GET of
//   https://www.csgraduates.com/study_methods/408quiz/<year>/)

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const year = argValue('--year');
if (!year || !/^\d{4}$/.test(year)) {
  console.error('Usage: node scripts/fetch-real-exam-source.mjs --year <YYYY> [--url <override>]');
  process.exit(1);
}
const urlArg = process.argv.indexOf('--url');
const sourceUrl = urlArg >= 0 ? process.argv[urlArg + 1] : `https://www.csgraduates.com/study_methods/408quiz/${year}/`;
const OUT_PATH = join(process.cwd(), 'kaoyan-408-content-starter', 'imports', `real-exam-${year}-source.json`);

function decodeEntities(text) {
  return text
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

/** HTML → display text: drop tags, keep <br> and code-block newlines. */
function htmlToText(fragment) {
  return decodeEntities(
    fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '· ')
      // code blocks: Hugo/Doxygen highlight wraps tokens in <span>; strip tags
      // and normalise the per-line spans into plain lines.
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function main() {
  // Read from stdin (fetch happens in the caller shell to keep this pure).
  const html = readFileSync(0, 'utf8');

  const mainStart = html.indexOf('id=content-panel');
  const working = mainStart >= 0 ? html.slice(mainStart) : html;
  const contentEnd = working.search(/<footer|<div class="td-footer"/);
  const body = contentEnd > 0 ? working.slice(0, contentEnd) : working;

  const questions = [];
  // Split into question blocks on <h5 id=N>.
  const blockRe = /<h5 id=(\d+)>\s*(\d+)<\/h5>/g;
  const blocks = [];
  let match;
  while ((match = blockRe.exec(body)) !== null) {
    blocks.push({ start: match.index, questionNo: Number(match[2]) });
  }
  // Subject markers: <h4 id=数据结构>… and section markers 选择题/解答题.
  const markerRe = /<h(3|4) id=([^>]+)>/g;
  const markers = [];
  while ((match = markerRe.exec(body)) !== null) {
    markers.push({ position: match.index, level: Number(match[1]), id: decodeEntities(match[2]) });
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockEnd = index + 1 < blocks.length ? blocks[index + 1].start : body.length;
    const chunk = body.slice(block.start, blockEnd);

    let subject = null;
    let section = null;
    for (const marker of markers) {
      if (marker.position >= block.start) break;
      if (marker.level === 4) subject = marker.id;
      if (marker.level === 3) section = marker.id;
    }

    const answerMatch = /data-answer=["']?([A-Z])/.exec(chunk);
    const isMcq = Boolean(answerMatch);

    // Stem: content from the h5 up to the choice container (MCQ) or the whole
    // block up to the solution area (essay — solution blocks carry 正确答案/
    // 参考答案 headers, which are NOT part of the stem).
    const containerIndex = chunk.search(/<div class=.choice-container/);
    let stemSource = containerIndex > 0 ? chunk.slice(0, containerIndex) : chunk;
    if (!isMcq) {
      // Essays: cut before the solution/feedback area (查看答案与解析 button,
      // tag containers after the solution) — only the 题面 belongs in the stem.
      const solutionIndex = stemSource.search(/查看答案与解析|class=.quiz-actions|class=.feedback-area|class=.quiz-tag-container/);
      if (solutionIndex > 0) stemSource = stemSource.slice(0, solutionIndex);
    }
    const stem = htmlToText(stemSource)
      .replace(/\u200b/g, '')
      .replace(/^41|^\d+\s*/, (prefix, offset) => (offset === 0 && prefix === String(block.questionNo) ? '' : prefix))
      .replace(new RegExp(`^${block.questionNo}\\b`), '')
      .trim();

    const options = {};
    if (isMcq) {
      // Capture from the letter label to the end of the label element: option
      // text may contain nested spans (math rendering), so a lazy match on
      // </span> truncates it — </label> is the reliable boundary.
      const optionRe = /<span class=choice-label>([A-Z])[.]?<\/span>([\s\S]*?)<\/label>/g;
      let optionMatch;
      while ((optionMatch = optionRe.exec(chunk)) !== null) {
        const letter = optionMatch[1];
        const text = htmlToText(optionMatch[2]).replace(/^[A-Z]\s*[.、]?\s*/, '').replace(/\s+/g, ' ').trim();
        options[letter] = text;
      }
    }

    questions.push({
      questionNo: block.questionNo,
      subject,
      section: section ?? null,
      kind: isMcq ? 'mcq' : 'essay',
      stem,
      options,
      answer: isMcq ? answerMatch[1] : null,
    });
  }

  const mcqCount = questions.filter((question) => question.kind === 'mcq').length;
  const essayCount = questions.filter((question) => question.kind === 'essay').length;
  const missingOptions = questions.filter((question) => question.kind === 'mcq' && Object.keys(question.options).length !== 4);
  const payload = {
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    note: '题面原文+官方答案字母（公开考试材料）。站方解析未提取——本项目解析/陷阱为自写原创。',
    questions,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Extracted ${questions.length} questions (mcq ${mcqCount}, essay ${essayCount}) -> ${OUT_PATH}`);
  if (mcqCount !== 40 || essayCount !== 7) {
    console.error(`⚠ expected 40 mcq + 7 essay, got ${mcqCount}+${essayCount} — inspect before use`);
  }
  if (missingOptions.length > 0) {
    console.error(`⚠ ${missingOptions.length} MCQ(s) without exactly 4 options: ${missingOptions.map((question) => question.questionNo).join(',')}`);
  }
}

import { readFileSync } from 'node:fs';
main();
