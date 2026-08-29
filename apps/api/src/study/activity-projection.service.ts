import { Injectable } from '@nestjs/common';
import { countByDate, lastNDates, studyDateKey } from './study-date';

export interface ActivityPracticeRecordFact {
  submittedAt: string | Date;
}

export interface ActivityTaskCompletionFact {
  completedDate: string;
}

export interface ActivityDaySnapshot {
  date: string;
  completedTaskCount: number;
  practiceCount: number;
  isActive: boolean;
}

export interface ActivitySnapshot {
  days: ActivityDaySnapshot[];
  today: ActivityDaySnapshot;
  streakDays: number;
  todayPracticeCount: number;
}

export interface BuildActivitySnapshotInput {
  dates?: string[];
  practiceRecords: ActivityPracticeRecordFact[];
  taskCompletions: ActivityTaskCompletionFact[];
}

const EMPTY_DAY: ActivityDaySnapshot = {
  date: '',
  completedTaskCount: 0,
  practiceCount: 0,
  isActive: false,
};

@Injectable()
export class ActivityProjectionService {
  buildSnapshot(input: BuildActivitySnapshotInput): ActivitySnapshot {
    const dates = input.dates ?? lastNDates(7);
    const practiceCounts = countByDate(input.practiceRecords.map((record) => studyDateKey(record.submittedAt)));
    const completedTaskCounts = countByDate(input.taskCompletions.map((completion) => completion.completedDate));
    const days = dates.map((date) => toActivityDay(date, completedTaskCounts, practiceCounts));
    const today = days[days.length - 1] ?? EMPTY_DAY;

    return {
      days,
      today,
      streakDays: countTrailingActiveDays(days),
      todayPracticeCount: today.practiceCount,
    };
  }
}

function toActivityDay(
  date: string,
  completedTaskCounts: Map<string, number>,
  practiceCounts: Map<string, number>,
): ActivityDaySnapshot {
  const completedTaskCount = completedTaskCounts.get(date) ?? 0;
  const practiceCount = practiceCounts.get(date) ?? 0;

  return {
    date,
    completedTaskCount,
    practiceCount,
    isActive: completedTaskCount + practiceCount > 0,
  };
}

function countTrailingActiveDays(days: ActivityDaySnapshot[]) {
  let streakDays = 0;
  for (const day of [...days].reverse()) {
    if (!day.isActive) break;
    streakDays += 1;
  }
  return streakDays;
}
