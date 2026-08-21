import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function featureSources() {
  const paths = [
    'apps/web/src/features/knowledge-catalog/constants.ts',
    'apps/web/src/features/knowledge-catalog/catalogData.ts',
    'apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx',
    'apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx',
  ];
  const contents = await Promise.all(paths.map(source));
  return contents.join('\n');
}

test('knowledge catalog section is wired into navigation and the student shell', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  const unionRegion = navigation.slice(0, navigation.indexOf('interface NavigationItem'));
  assert.match(unionRegion, /'knowledge-catalog'/, 'RoleSection should include knowledge-catalog');
  assert.match(navigation, /'knowledge-catalog'/, 'navigation should reference the section id');
  assert.match(navigation, /\{ id: 'knowledge-catalog', label: '知识', icon: Network \}/, 'student navigation should expose the knowledge catalog as 知识');

  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /KnowledgeCatalog/, 'App should lazy-import KnowledgeCatalog');
  assert.match(app, /visibleSection === 'knowledge-catalog'/, 'App should render the knowledge-catalog branch');
});

test('catalogData reads the root authoritative JSON only', async () => {
  const loader = await source('apps/web/src/features/knowledge-catalog/catalogData.ts');
  assert.match(loader, /data\/408\/knowledge-tree-408-v2\.json/, 'catalogData should import the root tree');
  assert.match(loader, /data\/408\/frequency-model-v2\.json/, 'catalogData should import the root frequency model');
  assert.doesNotMatch(loader, /knowledge-catalog\/knowledge-tree-408-v2\.json/, 'must not read the removed duplicate');
  assert.doesNotMatch(loader, /knowledge-catalog\/frequency-model-v2\.json/, 'must not read the removed duplicate');
  assert.match(loader, /buildKnowledgeTree/, 'catalogData should call buildKnowledgeTree');
  assert.match(loader, /joinFrequencyEvidence/, 'catalogData should call joinFrequencyEvidence');
});

test('page constants cover four subjects and honest trend / AllTime copy', async () => {
  const constants = await source('apps/web/src/features/knowledge-catalog/constants.ts');
  for (const [code, name] of Object.entries({
    DS: '数据结构',
    CO: '计算机组成原理',
    OS: '操作系统',
    CN: '计算机网络',
  })) {
    assert.match(constants, new RegExp(`${code}`), `constants should map ${code}`);
    assert.match(constants, new RegExp(name), `constants should name ${code}`);
  }
  assert.match(constants, /长期考频证据/, 'All Time Evidence copy must be 长期考频证据');
  assert.match(constants, /暂无考频数据/, 'missing evidence copy must be 暂无考频数据');
  for (const label of ['上升', '稳定', '下降', '冷门']) {
    assert.match(constants, new RegExp(label), `trend label ${label}`);
  }
});

test('page uses summarizeSubject and renders the four-subject tabs', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /summarizeSubject/, 'subject summary must come from summarizeSubject');
  assert.match(page, /章节数/, 'page should show chapter count label');
  assert.match(page, /小节数/, 'page should show section count label');
  assert.match(page, /原子知识点数/, 'page should show atomic point count label');
  assert.match(page, /KnowledgeTree/, 'page should render KnowledgeTree');
});

test('tree renders chapter/section/atomic rows with expand/collapse and honest frequency labels', async () => {
  const tree = await source('apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx');
  assert.match(tree, /expanded/, 'tree should keep expand state');
  assert.match(tree, /chapter/i, 'tree should render chapters');
  assert.match(tree, /section/i, 'tree should render sections');
  assert.match(tree, /近3年/, 'atomic row should show 近3年');
  assert.match(tree, /近5年/, 'atomic row should show 近5年');
  assert.match(tree, /ALL_TIME_EVIDENCE_LABEL/, 'atomic row should render the AllTime label constant');
  assert.match(tree, /NO_FREQUENCY_LABEL/, 'missing evidence should render the no-frequency label');
  assert.match(tree, /重要度/, 'importance must be shown separately from frequency');
  assert.match(tree, /难度/, 'difficulty should be displayed');
});

test('forbidden misleading historical-frequency copy never appears', async () => {
  const content = await featureSources();
  assert.doesNotMatch(content, /历史精确考频/);
  assert.doesNotMatch(content, /2009-2026精确考频/);
  assert.doesNotMatch(content, /2009–2026精确考频/);
});

test('search and filter controls are wired to the shared pure functions', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /搜索当前科目知识点/, 'search box placeholder should exist');
  assert.match(page, /只看高频/, 'high-frequency toggle should exist');
  assert.match(page, /重要度 ≥ 4/, 'importance filter should exist');
  assert.match(page, /全部展开/, 'expand-all button should exist');
  assert.match(page, /全部收起/, 'collapse-all button should exist');
  assert.match(page, /没有符合条件的知识点/, 'empty-results message should exist');
  assert.match(page, /import \{[^}]*filterKnowledgeTree[^}]*\} from '@kaoyan408\/shared'/, 'should import shared filter');
  assert.match(page, /import \{[^}]*searchKnowledgeTree[^}]*\} from '@kaoyan408\/shared'/, 'should import shared search');
  assert.match(page, /filterKnowledgeTree\(/, 'should call filterKnowledgeTree');
  assert.match(page, /searchKnowledgeTree\(/, 'should call searchKnowledgeTree');
  assert.match(page, /onlyHighFrequency/, 'should pass the frequency option instead of deriving it from importance');
  assert.match(page, /onlyHighImportance/, 'should pass the importance option separately');
});

test('searching auto-expands matched sections so hits are visible', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /useEffect/, 'page should react to query changes');
  assert.match(page, /query\.trim\(\)/, 'auto-expand must depend on a non-empty query');
  assert.match(page, /mode: 'expand'/, 'auto-expand should issue an expand command');
  assert.match(page, /setExpansion\(/, 'auto-expand should bump the expansion command version');
});

test('tree atomic points are selectable without breaking expansion', async () => {
  const tree = await source('apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx');
  assert.match(tree, /onSelectPoint/, 'tree should accept a point selection callback');
  assert.match(tree, /onSelectPoint\(point\)/, 'clicking a point should invoke the callback');
  assert.match(tree, /expandedChapters|expandedSections/, 'expansion state must remain');

  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /onSelectPoint/, 'page should pass a selection callback to the tree');
});

test('detail drawer reuses the existing OverlayDialog and resolved contexts only', async () => {
  const drawer = await source('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx');
  assert.match(drawer, /OverlayDialog/, 'drawer should reuse the existing OverlayDialog');
  assert.match(drawer, /CatalogPointContext/, 'drawer should consume resolved point contexts');
  assert.match(drawer, /ALL_TIME_EVIDENCE_LABEL/, 'drawer should render the honest AllTime label constant');
  assert.match(drawer, /NO_FREQUENCY_LABEL/, 'drawer should render the no-frequency label constant');
  assert.match(drawer, /前置知识/, 'drawer should render 前置知识 section');
  assert.match(drawer, /相关知识/, 'drawer should render 相关知识 section');
  assert.match(drawer, /暂无/, 'empty reference sections should show a compact empty state');
  assert.doesNotMatch(drawer, /历史精确考频/, 'drawer must not claim precise historical frequency');
});

test('detail drawer shows breadcrumb, core attributes and honest frequency labels', async () => {
  const drawer = await source('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx');
  assert.match(drawer, /subjectName/, 'drawer should show the subject name');
  assert.match(drawer, /chapterName/, 'drawer breadcrumb should include the chapter name');
  assert.match(drawer, /sectionName/, 'drawer breadcrumb should include the section name');
  assert.match(drawer, /重要度/, 'drawer should show importance');
  assert.match(drawer, /难度/, 'drawer should show difficulty');
  assert.match(drawer, /近3年/, 'drawer should show Recent3Y evidence');
  assert.match(drawer, /近5年/, 'drawer should show Recent5Y evidence');
  assert.match(drawer, /趋势/, 'drawer should show trend');
});

test('catalog page builds a point index once and wires the detail drawer', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /buildKnowledgePointIndex/, 'page should build the atomic point index');
  assert.match(page, /resolveKnowledgePointRefs/, 'page should resolve point references');
  assert.match(page, /pointIndex/, 'page should keep the point index');
  assert.match(page, /KnowledgePointDetailDrawer/, 'page should render the detail drawer');
  assert.match(page, /selectedPointId/, 'page should track the selected point id');
  assert.match(page, /prerequisiteContexts/, 'page should resolve prerequisites into contexts');
  assert.match(page, /relatedContexts/, 'page should resolve related points into contexts');
});

test('knowledge catalog remains in navigation without competing with the first-screen route', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.doesNotMatch(
    launchpad,
    /onNavigate\('knowledge-catalog'\)|408知识图谱/,
    'launchpad should not duplicate the catalog as a competing first-screen action',
  );
});

test('catalogData joins chapter/section stats from the real stats file', async () => {
  const loader = await source('apps/web/src/features/knowledge-catalog/catalogData.ts');
  assert.match(
    loader,
    /data\/408\/knowledge-catalog\/chapter-section-stats-2022-2026\.json/,
    'catalogData should import the real chapter/section stats file',
  );
  assert.match(loader, /joinChapterSectionStats/, 'catalogData should call joinChapterSectionStats');
  assert.doesNotMatch(loader, /knowledge-catalog\/knowledge-tree-408-v2\.json/, 'tree must stay at the root authority');
  assert.doesNotMatch(loader, /knowledge-catalog\/frequency-model-v2\.json/, 'frequency must stay at the root authority');
});

test('tree renders honest chapter and section stats from the joined DTO only', async () => {
  const tree = await source('apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx');
  assert.match(tree, /chapter\.stats|stats\?/, 'chapter head should consult stats');
  assert.match(tree, /近5年主考分值/, 'chapter should show 近5年主考分值');
  assert.match(tree, /涉及/, 'chapter should show related question count copy');
  assert.match(tree, /年出现/, 'chapter should show year coverage copy');
  assert.match(tree, /主考/, 'section should show a light 主考 stat');
  assert.match(tree, /section\.stats|stats\?/, 'section head should consult stats');
  assert.doesNotMatch(tree, /chapter-section-stats-2022-2026/, 'tree must not parse raw stats JSON');
  assert.doesNotMatch(tree, /历史精确分值/, 'misleading precise historical score copy is forbidden');
  assert.doesNotMatch(tree, /历史总贡献分值/, 'misleading total contribution score copy is forbidden');
  assert.match(tree, /重要度/, 'importance display must remain');
  assert.match(tree, /近3年/, 'Recent3Y display must remain');
  assert.match(tree, /近5年/, 'Recent5Y display must remain');
  assert.match(tree, /ALL_TIME_EVIDENCE_LABEL/, 'AllTime label display must remain');
});

test('catalog first screen recommends what to inspect before the full tree', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /buildKnowledgeCatalogFirstScreenHighlights/, 'page should use the shared first-screen helper');
  assert.match(page, /catalog-first-screen/, 'page should render a dedicated first-screen recommendation area');
  assert.match(page, /建议先看/, 'recommendation area should explain the first-screen intent');
  assert.match(page, /highlight\.title/, 'recommendation cards should render the helper category title');
  assert.match(page, /highlight\.reason/, 'recommendation cards should render the helper reason');
  assert.match(page, /highlight\.statusLabel/, 'recommendation cards should render the helper status');
  assert.match(page, /highlight\.actionLabel/, 'recommendation cards should render a concrete next action');
  assert.match(page, /highlight\.actionHint/, 'recommendation cards should explain why the action helps');
  assert.match(
    page,
    /setSelectedPointId\(highlight\.point\.id\)/,
    'clicking a recommendation should reuse the existing detail drawer selection path',
  );
});

test('catalog first-screen action cards carry their intent into the detail drawer', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(page, /selectedActionType/, 'page should track the selected recommendation action type');
  assert.match(
    page,
    /setSelectedActionType\(highlight\.actionType\)/,
    'recommendation card click should capture the helper action type',
  );
  assert.match(page, /focusIntent=\{selectedActionType\}/, 'page should pass the selected intent into the drawer');
  assert.match(
    page,
    /onSelectPoint=\{\(point\) => \{[\s\S]*setSelectedActionType\(null\)[\s\S]*setSelectedPointId\(point\.id\)/,
    'ordinary tree selection should clear recommendation intent before opening the drawer',
  );
  assert.match(
    page,
    /onClose=\{\(\) => \{[\s\S]*setSelectedActionType\(null\)[\s\S]*setSelectedPointId\(null\)/,
    'closing the drawer should clear the remembered recommendation intent',
  );
});

test('detail drawer maps recommendation intent to a focused section', async () => {
  const drawer = await source('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx');
  assert.match(drawer, /CatalogFirstScreenActionType/, 'drawer should accept the shared recommendation action type');
  assert.match(drawer, /focusIntent/, 'drawer should receive the recommendation intent');
  assert.match(drawer, /scrollIntoView/, 'drawer should bring the intended section into view');
  assert.match(drawer, /catalog-drawer-section-focused/, 'drawer should visually highlight the intended section');
  assert.match(drawer, /focusIntent === 'inspect'/, 'inspect intent should map to learning evidence and mastery');
  assert.match(drawer, /focusIntent === 'exam'/, 'exam intent should map to 真题命中');
  assert.match(drawer, /focusIntent === 'quest'/, 'quest intent should map to 节点闯关');
  assert.match(drawer, /tabIndex=\{-1\}/, 'focused static sections should be programmatically focusable');
});

test('detail drawer does not offer executable practice or quest actions before related questions exist', async () => {
  const drawer = await source('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx');
  assert.match(drawer, /hasRelatedQuestions/, 'drawer should derive whether this point has exercisable questions');
  assert.match(drawer, /actionDataPending/, 'drawer should distinguish loading from a true no-question state');
  assert.match(drawer, /disabled=\{!hasRelatedQuestions\}/, 'practice navigation should be disabled without related questions');
  assert.match(drawer, /disabled=\{!canStartQuest\}/, 'quest start should be disabled without related questions');
  assert.match(drawer, /题库加载中/, 'loading state should not look like an executable action');
  assert.match(drawer, /暂无题库题/, 'empty题库 state should be explicit');
  assert.match(drawer, /暂无闯关题/, 'empty闯关 state should be explicit');
  assert.match(drawer, /真题命中/, 'empty题库 guidance should point to exam evidence when available');
});
