import type { StudentAction } from './studentAction';

export interface StudentActionCandidates {
  session: StudentAction[];
  today: StudentAction[];
  review: StudentAction[];
  wrongQuestion: StudentAction[];
  knowledge: StudentAction[];
  assessment: StudentAction[];
  training: StudentAction[];
  report: StudentAction[];
  coach: StudentAction[];
}

export interface StudentActionCandidateInput {
  todayAction: StudentAction | null;
  session?: readonly StudentAction[];
  review?: readonly StudentAction[];
  wrongQuestion?: readonly StudentAction[];
  knowledge?: readonly StudentAction[];
  assessment?: readonly StudentAction[];
  training?: readonly StudentAction[];
  report?: readonly StudentAction[];
  coach?: readonly StudentAction[];
}

export function buildStudentActionCandidates(input: StudentActionCandidateInput): StudentActionCandidates {
  const candidates: StudentActionCandidates = {
    session: [],
    today: [],
    review: [],
    wrongQuestion: [],
    knowledge: [],
    assessment: [],
    training: [],
    report: [],
    coach: [],
  };
  const seenIds = new Set<string>();

  appendUnique(candidates.session, input.session, seenIds);
  appendUnique(candidates.today, input.todayAction ? [input.todayAction] : [], seenIds);
  appendUnique(candidates.review, input.review, seenIds);
  appendUnique(candidates.wrongQuestion, input.wrongQuestion, seenIds);
  appendUnique(candidates.knowledge, input.knowledge, seenIds);
  appendUnique(candidates.assessment, input.assessment, seenIds);
  appendUnique(candidates.training, input.training, seenIds);
  appendUnique(candidates.report, input.report, seenIds);
  appendUnique(candidates.coach, input.coach, seenIds);

  return candidates;
}

function appendUnique(
  target: StudentAction[],
  source: readonly StudentAction[] | undefined,
  seenIds: Set<string>,
): void {
  for (const action of source ?? []) {
    if (seenIds.has(action.id)) continue;
    seenIds.add(action.id);
    target.push(action);
  }
}
