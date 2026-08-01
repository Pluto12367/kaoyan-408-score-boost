import { Injectable } from '@nestjs/common';
import type { DocumentBlock, ParsedPage } from './document-blocks';

@Injectable()
export class ImportQualityService {
  assess(blocks: DocumentBlock[]): ParsedPage['quality'] {
    if (blocks.length === 0) return { score: 0, signals: ['empty_page'] };
    const textBlocks = blocks.filter((block): block is Extract<DocumentBlock, { kind: 'text' }> => block.kind === 'text' && block.text.trim().length > 0);
    if (textBlocks.length === 0) return { score: 0.25, signals: ['missing_text'] };
    const confidences = textBlocks.map((block) => block.confidence).filter((value): value is number => value !== undefined);
    if (confidences.length > 0 && confidences.reduce((sum, value) => sum + value, 0) / confidences.length < 0.6) return { score: 0.5, signals: ['low_confidence'] };
    return { score: 1, signals: [] };
  }

  needsFallback(quality: ParsedPage['quality']): boolean {
    return quality.score < 0.6 || quality.signals.some((signal) => ['empty_page', 'missing_text'].includes(signal));
  }
}
