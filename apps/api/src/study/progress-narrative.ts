/**
 * V9 Phase 3 — ProgressStory (pure module).
 *
 * Coach-voiced week-over-week progress: only deltas with a comparable
 * baseline are narrated (GitHub-Pulse pattern); everything else is an
 * explicit no_data line. Milestones appear only with evidence.
 */

export interface MasteryPoint {
  date: string;
  averageMastery: number | null;
}

export interface ProgressStoryInput {
  masterySeries: readonly MasteryPoint[];
  accuracyTrend: { status: string; value: number | null; baseline: number | null };
  gatesPassed: number;
  resolvedCount: number | null;
  streak: number;
}

export type ProgressStoryLineKind = 'gain' | 'decline' | 'flat' | 'milestone' | 'no_data';

export interface ProgressStoryLine {
  kind: ProgressStoryLineKind;
  text: string;
}

export interface ProgressStory {
  lines: ProgressStoryLine[];
  weekDelta: number | null;
}

function weeklyMean(series: readonly MasteryPoint[]): number | null {
  const values = series.map((point) => point.averageMastery).filter((value): value is number => value != null);
  if (values.length < 2) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildProgressStory(input: ProgressStoryInput): ProgressStory {
  const series = input.masterySeries;
  const half = Math.floor(series.length / 2);
  const priorMean = weeklyMean(series.slice(0, half));
  const currentMean = weeklyMean(series.slice(half));

  const lines: ProgressStoryLine[] = [];
  let weekDelta: number | null = null;

  if (priorMean != null && currentMean != null) {
    weekDelta = Math.round((currentMean - priorMean) * 10) / 10;
    if (weekDelta >= 1) {
      lines.push({ kind: 'gain', text: `本周平均掌握度较上周 +${weekDelta} 点` });
    } else if (weekDelta <= -1) {
      lines.push({ kind: 'decline', text: `本周平均掌握度较上周回落 ${Math.abs(weekDelta)} 点` });
    } else {
      lines.push({ kind: 'flat', text: '本周平均掌握度与上周基本持平' });
    }
  } else {
    lines.push({ kind: 'no_data', text: '掌握度快照不足，暂无法对比上周——继续练习会自动积累。' });
  }

  if (input.gatesPassed > 0) {
    lines.push({ kind: 'milestone', text: `${input.gatesPassed} 个知识节点通过证据门槛，提升有据可依。` });
  }
  if (input.resolvedCount != null && input.resolvedCount > 0) {
    lines.push({ kind: 'milestone', text: `重做解决 ${input.resolvedCount} 道错题。` });
  }
  if (input.streak >= 7) {
    lines.push({ kind: 'milestone', text: `连续学习 ${input.streak} 天，节奏已经成型。` });
  }

  return { lines, weekDelta };
}
