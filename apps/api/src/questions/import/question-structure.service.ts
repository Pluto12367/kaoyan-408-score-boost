import { Injectable } from '@nestjs/common';
import type { ParsedDocument, SourceRegion } from './document-blocks';

export interface CandidateQuestionDraft {
  stem: string; options: string[]; answer: string; analysis: string; pageNumber: number;
  sourceRegion?: SourceRegion; formulas: Array<{ latex: string; region: SourceRegion }>; assetIds: string[];
  warnings: Array<{ code: string; severity: 'warning' | 'error'; message: string }>;
}

@Injectable()
export class QuestionStructureService {
  structure(document: ParsedDocument): CandidateQuestionDraft[] {
    const entries = document.pages.flatMap((page) => page.blocks.map((block) => ({ page, block })));
    const questions: Array<{ pageNumber: number; region: SourceRegion; content: string; endPage: number }> = [];
    for (const entry of entries) {
      if (entry.block.kind !== 'text') continue;
      const markers = [...entry.block.text.matchAll(/^\s*\d+[.、．]/gmu)];
      if (markers.length === 0) {
        if (questions.length > 0) { questions.at(-1)!.content += `\n${entry.block.text}`; questions.at(-1)!.endPage = entry.page.pageNumber; }
        continue;
      }
      const leading = entry.block.text.slice(0, markers[0].index).trim();
      if (leading && questions.length > 0) { questions.at(-1)!.content += `\n${leading}`; questions.at(-1)!.endPage = entry.page.pageNumber; }
      for (let index = 0; index < markers.length; index += 1) {
        const start = markers[index].index!;
        const end = markers[index + 1]?.index ?? entry.block.text.length;
        questions.push({ pageNumber: entry.page.pageNumber, region: entry.block.region, content: entry.block.text.slice(start, end), endPage: entry.page.pageNumber });
      }
    }
    return questions.map((question) => {
      const content = question.content;
      const [first, ...remainder] = content.split(/\r?\n/u);
      const optionLines = remainder.filter((line) => /^\s*[A-D][.、．]/iu.test(line));
      const answer = /(?:answer|答案)\s*[:：]?\s*([A-D])/iu.exec(content)?.[1]?.toUpperCase() ?? '';
      const analysis = /(?:analysis|解析)\s*[:：]?\s*([\s\S]*?)(?=\n\s*\d+[.、．]|$)/iu.exec(content)?.[1]?.trim() ?? '';
      const formulas = entries.filter((entry) => entry.block.kind === 'formula' && entry.page.pageNumber >= question.pageNumber && entry.page.pageNumber <= question.endPage)
        .map((entry) => ({ latex: (entry.block as Extract<typeof entry.block, { kind: 'formula' }>).latex, region: entry.block.region }));
      const warnings = question.endPage !== question.pageNumber ? [{ code: 'CROSS_PAGE_OWNERSHIP_UNCERTAIN', severity: 'warning' as const, message: 'Cross-page content was associated with the preceding numbered question.' }] : [];
      return { stem: first.replace(/^\s*\d+[.、．]\s*/u, '').trim(), options: optionLines, answer, analysis, pageNumber: question.pageNumber, sourceRegion: question.region, formulas, assetIds: [], warnings };
    });
  }
}
