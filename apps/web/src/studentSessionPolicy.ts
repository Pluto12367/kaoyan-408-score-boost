export function isStudentOverviewReady(dataEnabled: boolean, hasOverview: boolean) {
  return dataEnabled && hasOverview;
}

export function shouldHydrateSessionFromOverview(staticDemoMode: boolean, hasOverview: boolean) {
  return staticDemoMode && hasOverview;
}
