import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('StageAssessment controller wiring is valid', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  const mod = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');

  assert.match(controller, /import \{ StageAssessmentQueryService \} from '\.\/stage-assessment-query\.service';/);
  assert.match(controller, /private readonly stageAssessmentQuery: StageAssessmentQueryService/);
  assert.match(controller, /getStageAssessmentCompat\(this\.resolveUserId\(user, viewUserId\)\)/);
  assert.match(controller, /@Get\('assessments\/stage'\)/);
  assert.equal(controller.includes('this.studyService.getStageAssessment('), false);

  assert.match(mod, /import \{ StageAssessmentQueryService \} from '\.\/stage-assessment-query\.service';/);
  assert.match(mod, /import \{ StageAssessmentProjectionService \} from '\.\/stage-assessment-projection\.service';/);
  assert.match(mod, /import \{ AssessmentProjectionService \} from '\.\/assessment-projection\.service';/);
  assert.match(mod, /AssessmentProjectionService/);
  assert.match(mod, /StageAssessmentProjectionService/);
  assert.match(mod, /StageAssessmentQueryService/);
});

test('StageAssessment controller preserves guard, roles, and userId resolve', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /@Get\('assessments\/stage'\)/);
  assert.match(controller, /@UseGuards\(RoleGuard\)/);
  assert.match(controller, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(controller, /getStageAssessmentCompat\(this\.resolveUserId\(user, viewUserId\)\)/);
});

test('StageAssessment response remains DTO-compatible (pass-through)', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  // Controller must not construct DTO parts itself; it only delegates to QueryService
  assert.match(controller, /return this\.stageAssessmentQuery\.getStageAssessmentCompat/);
  // Ensure method does not do id/title/questions mapping inside controller
  const method = controller.slice(controller.indexOf('getStageAssessment('), controller.indexOf('getStageAssessment(') + 600);
  assert.equal(method.includes('title ='), false);
  assert.equal(method.includes('questions ='), false);
});