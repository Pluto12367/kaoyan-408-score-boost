export interface ActivityDaySnapshot {
  date: string;
  completedTaskCount: number;
  practiceCount: number;
}

export interface ActivitySnapshot {
  days: ActivityDaySnapshot[];
}

export interface LearningCalendarDayDto {
  date: string;
  completedTaskCount: number;
  practiceCount: number;
  isActive: boolean;
}

export interface LearningCalendarDto {
  days: LearningCalendarDayDto[];
  today: LearningCalendarDayDto;
  streakDays: number;
}

const EMPTY_DAY: LearningCalendarDayDto = {
  date: '',
  completedTaskCount: 0,
  practiceCount: 0,
  isActive: false,
};

export function buildLearningCalendarDto(snapshot: ActivitySnapshot): LearningCalendarDto {
  const days = snapshot.days.map(toLearningCalendarDayDto);

  return {
    days,
    today: days[days.length - 1] ?? EMPTY_DAY,
    streakDays: countTrailingActiveDays(days),
  };
}

function toLearningCalendarDayDto(day: ActivityDaySnapshot): LearningCalendarDayDto {
  const completedTaskCount = normalizeCount(day.completedTaskCount);
  const practiceCount = normalizeCount(day.practiceCount);

  return {
    date: day.date,
    completedTaskCount,
    practiceCount,
    isActive: completedTaskCount + practiceCount > 0,
  };
}

function normalizeCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function countTrailingActiveDays(days: LearningCalendarDayDto[]) {
  let streakDays = 0;
  for (const day of [...days].reverse()) {
    if (!day.isActive) break;
    streakDays += 1;
  }
  return streakDays;
}
