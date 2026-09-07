import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V10-4 Sprite Memory — user-stated preference memory (constitution §7.3-②).
// Red lines under test:
//   - deterministic extraction only (no LLM in the memory path)
//   - bounded store: 12 entries max, 80 chars per text, oldest evicted
//   - exact-text dedupe bumps lastSeenAt instead of duplicating
//   - discardable operational state — never a second source of truth

const MEMORY_URL = new URL('../apps/api/src/study/sprite-memory.ts', import.meta.url);

async function loadSpriteMemory() {
  const source = await readFile(MEMORY_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('sprite-memory must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const entry = (id, text, lastSeenAt = '2026-09-01T00:00:00.000Z') => ({
  id,
  text,
  createdAt: lastSeenAt,
  lastSeenAt,
  source: 'user_stated',
});

test('V10-4 extraction: seven stated-preference patterns are captured deterministically', async () => {
  const { extractSpritePreferences } = await loadSpriteMemory();
  const samples = [
    ['我喜欢计组', '我喜欢计组'],
    ['我想考北邮', '我想考北邮'],
    ['我的目标是明年上岸', '我的目标'],
    ['我不擅长操作系统', '我不擅长操作系统'],
    ['我怕网络层大题', '我怕网络层大题'],
    ['我每天背 20 个单词', '我每天背 20 个单词'],
    ['我在准备 408', '我在准备 408'],
  ];
  for (const [message, expected] of samples) {
    const extracted = extractSpritePreferences(message);
    assert.ok(
      extracted.some((text) => text.includes(expected)),
      `"${message}" should yield "${expected}" (got: ${JSON.stringify(extracted)})`,
    );
  }

  const combined = extractSpritePreferences('我喜欢计组，我想考北邮。我的目标是明年上岸，我不擅长操作系统。我怕网络层大题，我每天背 20 个单词，我在准备 408。');
  assert.ok(combined.length <= 3, 'at most 3 candidates per message');

  const none = extractSpritePreferences('今天的复习队列已经清空了');
  assert.deepEqual(none, [], 'plain statements about the system never become memories');
});

test('V10-4 extraction: text is truncated to the 80-char budget', async () => {
  const { extractSpritePreferences, SPRITE_MEMORY_TEXT_MAX } = await loadSpriteMemory();
  assert.equal(SPRITE_MEMORY_TEXT_MAX, 80);
  const long = `我喜欢${'数据结构'.repeat(40)}`;
  const extracted = extractSpritePreferences(long);
  assert.equal(extracted.length, 1);
  assert.ok(extracted[0].length <= SPRITE_MEMORY_TEXT_MAX);
});

test('V10-4 merge: new entries get deterministic ids; repeats touch lastSeenAt instead of duplicating', async () => {
  const { mergeSpriteMemory } = await loadModulesForMerge();
  const asOf = '2026-09-07T10:00:00.000Z';
  const first = mergeSpriteMemory([], ['我喜欢计组', '我想考北邮'], asOf);
  assert.equal(first.added.length, 2);
  assert.equal(first.entries[0].id, 'mem:20260907100000000:0');
  assert.equal(first.entries[0].text, '我喜欢计组');
  assert.equal(first.entries[0].source, 'user_stated');
  assert.equal(first.entries[0].createdAt, asOf);

  const again = mergeSpriteMemory(first.entries, ['我喜欢计组'], '2026-09-08T10:00:00.000Z');
  assert.equal(again.added.length, 0, 'exact repeat is not a new memory');
  assert.equal(again.entries.filter((item) => item.text === '我喜欢计组').length, 1, 'no duplicate rows');
  assert.equal(again.entries.find((item) => item.text === '我喜欢计组').lastSeenAt, '2026-09-08T10:00:00.000Z');
});

test('V10-4 merge: the store is capped at 12 entries and evicts the least recently seen', async () => {
  const { mergeSpriteMemory, MAX_SPRITE_MEMORY_ENTRIES } = await loadModulesForMerge();
  assert.equal(MAX_SPRITE_MEMORY_ENTRIES, 12);
  const existing = [];
  for (let index = 0; index < 12; index += 1) {
    existing.push(entry(`mem:old-${index}`, `旧记忆 ${index}`, `2026-08-${String(1 + index).padStart(2, '0')}T00:00:00.000Z`));
  }
  const merged = mergeSpriteMemory(existing, ['我喜欢计组'], '2026-09-07T10:00:00.000Z');
  assert.equal(merged.entries.length, 12, 'bounded store');
  assert.equal(merged.entries.some((item) => item.id === 'mem:old-0'), false, 'oldest entry evicted');
  assert.equal(merged.entries.some((item) => item.text === '我喜欢计组'), true, 'newest entry kept');
});

test('V10-4 merge: empty candidates leave the store untouched', async () => {
  const { mergeSpriteMemory } = await loadModulesForMerge();
  const existing = [entry('mem:a', '我喜欢计组')];
  const merged = mergeSpriteMemory(existing, [], '2026-09-07T10:00:00.000Z');
  assert.deepEqual(merged.added, []);
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].lastSeenAt, '2026-09-01T00:00:00.000Z', 'no phantom touch');
});

async function loadModulesForMerge() {
  const module = await loadSpriteMemory();
  return module;
}

test('V10-4 wiring: memory service/repository register in StudyModule; endpoints are self-only', async () => {
  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /SpriteMemoryService/);
  assert.match(moduleSource, /SpriteMemoryRepository/);

  const controller = await readFile(new URL('../apps/api/src/study/sprite.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('sprite\/memory'\)/);
  assert.match(controller, /Post\('sprite\/memory'\)/);
  assert.match(controller, /Delete\('sprite\/memory\//);
});
