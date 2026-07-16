export function isStudentOverviewReady(dataEnabled: boolean, hasOverview: boolean) {
  return dataEnabled && hasOverview;
}

export function shouldHydrateSessionFromOverview(staticDemoMode: boolean, hasOverview: boolean) {
  return staticDemoMode && hasOverview;
}

export function resolveSessionQuestions<T extends { id: string }>(
  questionIds: string[],
  sessionQuestions: T[],
  currentCatalog: T[],
) {
  const byId = new Map(currentCatalog.map((question) => [question.id, question]));
  for (const question of sessionQuestions) byId.set(question.id, question);
  return questionIds.flatMap((questionId) => {
    const question = byId.get(questionId);
    return question ? [question] : [];
  });
}

export function shouldQueueSessionSave(hasInFlightSave: boolean, keepalive: boolean) {
  return hasInFlightSave && !keepalive;
}
