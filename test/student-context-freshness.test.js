import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the production hook with a deterministic hook scheduler. No source
// rewrites, network requests, or installed DOM/test-renderer dependency needed.
function mount() {
  const slots = [], effects = [], requests = [];
  let cursor = 0;
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useRef(value) { const i = cursor++; slots[i] ??= { current: value }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const output = ts.transpileModule(readFileSync('apps/web/src/hooks/useStudentContextData.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    if (id === 'react') return react;
    if (id === '../api/env') return { isStaticDemoMode: () => false };
    if (id === '../api') return { fetchStudentContext: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
    throw new Error(`Unexpected hook dependency ${id}`);
  }, module, module.exports);
  let enabled = true, authKey = 'user-a';
  const render = (nextEnabled = enabled, nextAuthKey = authKey) => {
    enabled = nextEnabled; authKey = nextAuthKey; cursor = 0;
    const result = module.exports.useStudentContextData(enabled, authKey);
    while (effects.length) effects.shift()();
    return result;
  };
  return { requests, render, unmount: () => slots.forEach((slot) => slot.cleanup?.()) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const context = (userId, asOf) => ({ userId, asOf, freshness: { asOf } });

test('late older refresh cannot overwrite the newest canonical state', async () => {
  const h = mount();
  const hook = h.render();
  const latest = hook.refresh();
  h.requests[1].resolve(context('user-a', '2026-09-05T02:00:00Z'));
  await latest;
  h.requests[0].resolve(context('user-a', '2026-09-05T01:00:00Z'));
  await flush();
  assert.equal(h.render().context.data.asOf, '2026-09-05T02:00:00Z');
});

test('old request failure cannot turn a newer successful refresh into an error', async () => {
  const h = mount();
  const hook = h.render();
  const latest = hook.refresh();
  h.requests[1].resolve(context('user-a', 'server-time'));
  await latest;
  h.requests[0].reject(new Error('obsolete request failed'));
  await flush();
  assert.equal(h.render().context.state, 'ready');
});

test('auth switch immediately hides prior data and ignores the prior request', async () => {
  const h = mount();
  const hook = h.render();
  h.requests[0].resolve(context('user-a', 'a-time'));
  await flush();
  const oldRefresh = hook.refresh();
  assert.equal(h.render(true, 'user-b').context.data, null);
  h.requests[2].resolve(context('user-b', 'b-time'));
  await flush();
  h.requests[1].resolve(context('user-a', 'late-a-time'));
  await oldRefresh;
  assert.equal(h.render().context.data.userId, 'user-b');
});

test('disabled hook ignores in-flight responses and does not fetch on manual refresh', async () => {
  const h = mount();
  h.render();
  const disabled = h.render(false);
  h.requests[0].resolve(context('user-a', 'late-time'));
  await flush();
  assert.equal(h.render().context.data, null);
  await Promise.race([disabled.refresh(), flush()]);
  assert.equal(h.requests.length, 1);
});

test('latest request error stays explicit and preserves server timestamp in existing data', async () => {
  const h = mount();
  h.render();
  h.requests[0].resolve(context('user-a', 'server-time'));
  await flush();
  const request = h.render().refresh();
  h.requests[1].reject(new Error('offline'));
  await request;
  const result = h.render().context;
  assert.equal(result.state, 'error');
  assert.match(result.error, /offline/);
  assert.equal(result.data.asOf, 'server-time');
});
