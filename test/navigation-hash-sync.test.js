import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 1: the URL hash is the primary section source and back/forward is supported', async () => {
  const navigation = await source('apps/web/src/features/navigation/useRoleSectionNavigation.ts');

  assert.match(navigation, /SECTION_HASH_PREFIX = '#\/'/, 'sections should map to #/section URLs');
  assert.match(navigation, /function readSectionFromHash/, 'the module should parse the hash');
  const readStored = navigation.slice(navigation.indexOf('export function readStoredSection'), navigation.indexOf('export function useRoleSectionNavigation'));
  assert.ok(
    readStored.indexOf('readSectionFromHash(role)') < readStored.indexOf('sessionStorage'),
    'hash must be checked before the sessionStorage fallback',
  );
  assert.match(navigation, /addEventListener\('hashchange'/, 'back/forward and manual hash edits should update the section');
  assert.match(navigation, /history\.replaceState\(null, '', target\)/, 'the initial sync must not add a history entry');
  assert.match(navigation, /window\.location\.hash = `\/\$\{next\}`/, 'navigating should update the URL hash');
  assert.match(navigation, /sessionStorage\.setItem\(SECTION_STORAGE_KEY, activeSection\)/, 'sessionStorage compatibility must be kept');
});

test('Phase 1: the stage-assessment generate action moved from the top bar into its panel', async () => {
  const app = await source('apps/web/src/App.tsx');
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');

  assert.doesNotMatch(app, /onClick=\{handleGenerateAssessment\}>生成阶段测评/, 'the top bar should no longer duplicate the action');
  assert.match(panel, /onGenerate\?: \(\) => void/, 'the panel should accept a generate action');
  assert.match(panel, /生成阶段测评/, 'the panel should offer the generate action');
});
