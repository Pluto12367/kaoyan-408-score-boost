/**
 * LE/V11-M4 — forgetting-defense selector (pure).
 *
 * The "遗忘防线": mastered knowledge nodes (mastery ≥ floor at their peak in
 * the lookback window) whose latest snapshot has dropped by at least the
 * drop threshold become 保温复习 candidates. Read-only projection over
 * UserMasterySnapshot facts — never writes ReviewSchedule, never touches the
 * mastery writer. Surfacing (recommendation layer / coach) consumes this.
 */

export interface DecayDefenseNode {
  readonly knowledgeNodeId: string;
  readonly name: string;
  readonly subject: string;
}

export interface DecayDefenseSnapshot {
  readonly date: string;
  readonly mastery: number;
}

export interface DecayDefenseInput {
  readonly nodes: readonly DecayDefenseNode[];
  readonly currentMasteryByNode: Readonly<Record<string, number>>;
  readonly snapshotsByNode: Readonly<Record<string, readonly DecayDefenseSnapshot[]>>;
  readonly asOf: string;
  readonly lookbackDays: number;
  /** Only nodes that were at least this strong qualify (mastered band). */
  readonly masteryFloor: number;
  /** Required mastery decline inside the lookback window. */
  readonly dropThreshold: number;
}

export interface DecayDefenseCandidate {
  readonly knowledgeNodeId: string;
  readonly name: string;
  readonly subject: string;
  readonly peak: number;
  readonly current: number;
  readonly drop: number;
}

export const DECAY_DEFENSE_DEFAULTS = {
  lookbackDays: 14,
  masteryFloor: 0.7,
  dropThreshold: 0.15,
} as const;

export function buildDecayDefenseCandidates(
  input: DecayDefenseInput,
): DecayDefenseCandidate[] {
  const asOfMs = new Date(input.asOf).getTime();
  const windowStartMs = asOfMs - input.lookbackDays * 86_400_000;

  const candidates: DecayDefenseCandidate[] = [];
  for (const node of input.nodes) {
    const current = input.currentMasteryByNode[node.knowledgeNodeId];
    if (current == null) continue;
    const snapshots = (input.snapshotsByNode[node.knowledgeNodeId] ?? []).filter(
      (row) => {
        const ms = new Date(row.date).getTime();
        return ms >= windowStartMs && ms <= asOfMs;
      },
    );
    if (snapshots.length === 0) continue;
    const peak = Math.max(...snapshots.map((row) => row.mastery));
    if (peak < input.masteryFloor) continue;
    const drop = peak - current;
    if (drop < input.dropThreshold) continue;
    candidates.push({
      knowledgeNodeId: node.knowledgeNodeId,
      name: node.name,
      subject: node.subject,
      peak: Math.round(peak * 100) / 100,
      current: Math.round(current * 100) / 100,
      drop: Math.round(drop * 100) / 100,
    });
  }
  return candidates.sort((left, right) => right.drop - left.drop || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId));
}
