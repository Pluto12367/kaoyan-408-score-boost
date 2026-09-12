import { statement, type GuidanceStatement } from './guidance-copy';

/**
 * G1.8 — exam-date derivation (owner decision A6 = APPROVED).
 *
 * `User.examDate` existed but had no writer, while `User.remainingDays` was a
 * hand-typed integer that silently became the engine's `daysToExam`. The two
 * could disagree forever and the student had no way to see where the number
 * came from.
 *
 * The rule implemented here, shared by API and UI so they cannot disagree:
 *   examDate is the single fact; remainingDays is derived from it.
 *
 * The date is also never guessed: an unset date reports itself as unset rather
 * than falling back to a default that would look authoritative.
 *
 * Pure: no clock (`todayIso` is injected), no IO.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface ExamDateState {
  readonly examDate: string | null;
  readonly remainingDays: number | null;
  readonly daysLabel: string | null;
  readonly source: 'exam_date' | 'unset';
  readonly error: string | null;
  /** What the date means, in the student's words. */
  readonly meaningNote: string;
  readonly statement: GuidanceStatement;
}

function toUtcDay(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const millis = Date.UTC(year, month - 1, day);
  const parsed = new Date(millis);
  // Rejects calendar-impossible input such as 2026-13-45 or 2026-02-30.
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return millis;
}

function todayUtcDay(todayIso: string): number {
  const date = new Date(todayIso);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export const EXAM_DATE_MEANING_SET =
  '这是你的真实考试日期。系统所有节奏（复习间隔、冲刺相位、计划强度）都以它为准。';
export const EXAM_DATE_MEANING_UNSET =
  '考试日期未设置。系统不会把它当作已知：在需要时会按默认备考期（96 天）参与计划排序，并在计划里标注这一点。';

export function deriveExamDateState(input: {
  examDate: string | null | undefined;
  todayIso: string;
}): ExamDateState {
  // `null`/`undefined` means "clear it". Any string — including an empty one —
  // is input that must parse, so a cleared form field can never silently pass.
  if (input.examDate == null) {
    return {
      examDate: null,
      remainingDays: null,
      daysLabel: null,
      source: 'unset',
      error: null,
      meaningNote: EXAM_DATE_MEANING_UNSET,
      statement: statement('INSUFFICIENT_DATA', EXAM_DATE_MEANING_UNSET),
    };
  }

  const raw = input.examDate.trim();
  const target = toUtcDay(raw);
  if (target == null) {
    return {
      examDate: null,
      remainingDays: null,
      daysLabel: null,
      source: 'unset',
      error: '考试日期格式不正确，请使用 YYYY-MM-DD（例如 2026-12-20）。',
      meaningNote: EXAM_DATE_MEANING_UNSET,
      statement: statement('INSUFFICIENT_DATA', EXAM_DATE_MEANING_UNSET),
    };
  }

  const today = todayUtcDay(input.todayIso);
  if (Number.isNaN(today)) {
    return {
      examDate: null,
      remainingDays: null,
      daysLabel: null,
      source: 'unset',
      error: '无法确定今天的日期，请稍后重试。',
      meaningNote: EXAM_DATE_MEANING_UNSET,
      statement: statement('INSUFFICIENT_DATA', EXAM_DATE_MEANING_UNSET),
    };
  }

  if (target < today) {
    return {
      examDate: null,
      remainingDays: null,
      daysLabel: null,
      source: 'unset',
      error: '考试日期必须是未来的日期；如果考试已经结束，请录入成绩而不是考试日期。',
      meaningNote: EXAM_DATE_MEANING_UNSET,
      statement: statement('INSUFFICIENT_DATA', EXAM_DATE_MEANING_UNSET),
    };
  }

  const remainingDays = Math.round((target - today) / DAY_MS);
  const daysLabel = `距离考试 ${remainingDays} 天`;
  return {
    examDate: raw,
    remainingDays,
    daysLabel,
    source: 'exam_date',
    error: null,
    meaningNote: EXAM_DATE_MEANING_SET,
    statement: statement('FACT', `${daysLabel}（来源：你设置的考试日期 ${raw}）。`),
  };
}
