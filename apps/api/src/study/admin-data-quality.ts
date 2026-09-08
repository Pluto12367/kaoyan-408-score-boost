/**
 * V11-M1 — Admin Data Quality projection (pure).
 *
 * Makes the silent data exclusions measurable (audit B4/B6/B13): questions
 * without knowledge-node tags, knowledge points without a PRIMARY catalog
 * mapping, nodes without exam-frequency snapshots, and sparse relation
 * edges. Read-only observation — this projection never fixes or fabricates
 * data; content gaps are the content team's queue.
 */

export interface DataQualitySampleInput {
  readonly questionsWithoutNodeTags: readonly string[];
  readonly knowledgePointsWithoutPrimaryMap: readonly string[];
  readonly nodesWithoutFrequencySnapshot: readonly { readonly id: string; readonly subject: string }[];
}

export interface DataQualityInput {
  readonly questionTotal: number;
  readonly questionIdsWithNodeTags: ReadonlySet<string>;
  readonly knowledgePointTotal: number;
  readonly knowledgePointIdsWithPrimaryMap: ReadonlySet<string>;
  readonly nodeIds: readonly { readonly id: string; readonly subject: string }[];
  readonly nodeIdsWithFrequencySnapshot: ReadonlySet<string>;
  readonly prerequisiteEdgeCount: number;
  readonly relatedEdgeCount: number;
  readonly samples: DataQualitySampleInput;
  readonly generatedAt: string;
}

export interface DataQualityFlag {
  readonly flag: string;
  readonly detail: string;
}

export interface DataQualityReport {
  readonly questions: {
    readonly total: number;
    readonly withNodeTags: number;
    readonly withoutNodeTags: number;
    readonly coverageRate: number;
  };
  readonly knowledgePoints: {
    readonly total: number;
    readonly withPrimaryMap: number;
    readonly withoutPrimaryMap: number;
  };
  readonly nodes: {
    readonly total: number;
    readonly withFrequencySnapshot: number;
    readonly withoutFrequencySnapshot: number;
    readonly bySubject: readonly {
      readonly subject: string;
      readonly total: number;
      readonly withSnapshot: number;
      readonly withoutSnapshot: number;
    }[];
  };
  readonly relations: { readonly prerequisite: number; readonly related: number };
  readonly healthFlags: readonly DataQualityFlag[];
  readonly samples: {
    readonly questionsWithoutNodeTags: readonly string[];
    readonly knowledgePointsWithoutPrimaryMap: readonly string[];
    readonly nodesWithoutFrequencySnapshot: readonly { readonly id: string; readonly subject: string }[];
  };
  readonly generatedAt: string;
  readonly source: 'derived';
}

function coverageRate(withValue: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((withValue / total) * 100);
}

export function buildDataQualityReport(input: DataQualityInput): DataQualityReport {
  const questionWithout = Math.max(input.questionTotal - input.questionIdsWithNodeTags.size, 0);
  const kpWithout = Math.max(input.knowledgePointTotal - input.knowledgePointIdsWithPrimaryMap.size, 0);
  const withSnapshot = input.nodeIds.filter((node) => input.nodeIdsWithFrequencySnapshot.has(node.id));
  const withoutSnapshot = input.nodeIds.length - withSnapshot.length;

  const bySubject = new Map<string, { total: number; withSnapshot: number }>();
  for (const node of input.nodeIds) {
    const entry = bySubject.get(node.subject) ?? { total: 0, withSnapshot: 0 };
    entry.total += 1;
    if (input.nodeIdsWithFrequencySnapshot.has(node.id)) entry.withSnapshot += 1;
    bySubject.set(node.subject, entry);
  }

  const healthFlags: DataQualityFlag[] = [];
  if (questionWithout > 0) {
    healthFlags.push({ flag: 'questions_missing_node_tags', detail: `${questionWithout} 道题库题无知识节点标签（无法进入节点级推荐与诊断）` });
  }
  if (kpWithout > 0) {
    healthFlags.push({ flag: 'knowledge_points_missing_primary_map', detail: `${kpWithout} 个知识点缺 PRIMARY 目录映射（旧口径推荐与目录命名受限）` });
  }
  if (withoutSnapshot > 0) {
    healthFlags.push({ flag: 'nodes_missing_frequency_snapshot', detail: `${withoutSnapshot} 个节点无考频快照（推荐候选宇宙静默排除的来源，B4）` });
  }
  if (input.prerequisiteEdgeCount === 0) {
    healthFlags.push({ flag: 'relations_sparse', detail: '无先修关系边：PREREQUISITE_GAP 推荐与图谱导航无法兑现（B6）' });
  }

  return {
    questions: {
      total: input.questionTotal,
      withNodeTags: input.questionIdsWithNodeTags.size,
      withoutNodeTags: questionWithout,
      coverageRate: coverageRate(input.questionIdsWithNodeTags.size, input.questionTotal),
    },
    knowledgePoints: {
      total: input.knowledgePointTotal,
      withPrimaryMap: input.knowledgePointIdsWithPrimaryMap.size,
      withoutPrimaryMap: kpWithout,
    },
    nodes: {
      total: input.nodeIds.length,
      withFrequencySnapshot: withSnapshot.length,
      withoutFrequencySnapshot: withoutSnapshot,
      bySubject: [...bySubject.entries()]
        .map(([subject, stat]) => ({
          subject,
          total: stat.total,
          withSnapshot: stat.withSnapshot,
          withoutSnapshot: stat.total - stat.withSnapshot,
        }))
        .sort((left, right) => right.withoutSnapshot - left.withoutSnapshot || left.subject.localeCompare(right.subject)),
    },
    relations: {
      prerequisite: input.prerequisiteEdgeCount,
      related: input.relatedEdgeCount,
    },
    healthFlags,
    samples: {
      questionsWithoutNodeTags: input.samples.questionsWithoutNodeTags.slice(0, 10),
      knowledgePointsWithoutPrimaryMap: input.samples.knowledgePointsWithoutPrimaryMap.slice(0, 10),
      nodesWithoutFrequencySnapshot: input.samples.nodesWithoutFrequencySnapshot.slice(0, 10),
    },
    generatedAt: input.generatedAt,
    source: 'derived',
  };
}
