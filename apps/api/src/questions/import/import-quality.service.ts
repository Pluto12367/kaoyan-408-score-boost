import { Injectable } from '@nestjs/common';
import type { DocumentBlock, ParsedPage } from './document-blocks';

@Injectable()
export class ImportQualityService {
  assess(blocks: DocumentBlock[]): ParsedPage['quality'] {
    if (blocks.length === 0) return { score: 0, signals: ['empty_page'] };
    const textBlocks = blocks.filter((block): block is Extract<DocumentBlock, { kind: 'text' }> => block.kind === 'text' && block.text.trim().length > 0);
    if (textBlocks.length === 0) return { score: 0.25, signals: ['missing_text'] };
    const text = textBlocks.map((block) => block.text).join('\n');
    const signals: string[] = [];
    const visible = [...text].filter((character) => !/\s/u.test(character));
    const abnormal = visible.filter((character) => !/[\p{L}\p{N}\p{P}\p{S}]/u.test(character)).length;
    if (visible.length > 8 && abnormal / visible.length > 0.2) signals.push('abnormal_character_ratio');
    const hasOption = /(?:^|\n)\s*[AＡ][.、)）]/mu.test(text);
    if (hasOption && !['B', 'C', 'D'].every((label) => new RegExp(`(?:^|\\n)\\s*${label}[.、)）]`, 'mu').test(text))) signals.push('missing_choice_options');
    if (/答案|answer/iu.test(text) && !/解析|analysis/iu.test(text)) signals.push('missing_required_blocks');
    const confidences = textBlocks.map((block) => block.confidence).filter((value): value is number => value !== undefined);
    if (confidences.length > 0 && confidences.reduce((sum, value) => sum + value, 0) / confidences.length < 0.6) signals.push('low_confidence');
    return { score: signals.length ? 0.5 : 1, signals };
  }

  needsFallback(quality: ParsedPage['quality']): boolean {
    return this.shouldFallback(quality);
  }

  shouldFallback(quality: ParsedPage['quality']): boolean {
    return quality.signals.some((signal) => ['empty_page', 'abnormal_character_ratio', 'missing_choice_options', 'missing_required_blocks'].includes(signal));
  }
}
