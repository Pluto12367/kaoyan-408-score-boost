export function studyDateKey(
  value: string | Date,
  timeZone = process.env.APP_TIME_ZONE ?? 'Asia/Shanghai',
) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Unable to determine the study date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to determine the study date');
  return `${year}-${month}-${day}`;
}

export function todayKey(): string {
  return studyDateKey(new Date());
}

export function lastNDates(count: number): string[] {
  const today = new Date(`${todayKey()}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (count - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

export function nextNDates(count: number): string[] {
  const today = new Date(`${todayKey()}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function countByDate(dates: string[]): Map<string, number> {
  return dates.reduce((acc, date) => {
    const key = studyDateKey(date);
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
}
