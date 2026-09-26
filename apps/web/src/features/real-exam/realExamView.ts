// V14-R4-A — pure view helpers for the real-exam presentation surfaces.
// Rendering-only: zero local thresholds, zero recomputation of facts —
// everything displayed comes straight from the read-only projections.

import type { RealExamBoard, RealExamBoardSlot } from '../../api/endpoints/realExam';

export type SlotTone = 'correct' | 'wrong' | 'unanswered' | 'empty';

export function slotTone(slot: RealExamBoardSlot): SlotTone {
  if (!slot.questionId || slot.status == null) return 'empty';
  return slot.status;
}

export const SLOT_TONE_LABEL: Record<SlotTone, string> = {
  correct: '全对',
  wrong: '答错',
  unanswered: '未做',
  empty: '无题',
};

export function subjectBadge(subject: string | null): string {
  if (!subject) return '';
  if (subject === 'DS') return 'DS';
  if (subject === 'CO') return 'CO';
  if (subject === 'OS') return 'OS';
  if (subject === 'CN') return 'CN';
  return subject.slice(0, 2);
}

export function questionPath(examNo: number, year: number): string | null {
  // 408 结构：选择题 1-40、综合题 41-47（任务书 §3.1）。
  return examNo >= 1 && examNo <= 47 ? `真题 ${year} 年第 ${examNo} 题` : null;
}

export function hasRenderableBoard(board: RealExamBoard | null | undefined): boolean {
  return Boolean(board?.storeAvailable && board.slots.length > 0);
}
