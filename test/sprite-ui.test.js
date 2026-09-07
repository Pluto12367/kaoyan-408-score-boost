import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V10-2 Sprite UI — the companion's ambient surface (constitution §5.3, §6.1).
// Honesty rules under test:
//   - static demo mode renders nothing; hard fetch failure renders nothing
//     (ambient surface, V9 ProactiveCoachCard precedent) — API-level
//     degradation is expressed by the backend's own honest lines
//   - every rendered line can expose its evidenceRefs ("依据")
//   - mute preference persists in localStorage, never in any store
// Visual rules under test (DESIGN.md): token-only colors (zero hex),
// z-index 60 between bottom nav (40) and fullscreen layers (1000+),
// mobile offset above the bottom nav, prefers-reduced-motion honored.

const SPRITE_DIR = new URL('../apps/web/src/features/sprite/', import.meta.url);

const readSource = async (file) => readFile(new URL(file, SPRITE_DIR), 'utf8');

async function loadSpriteMood() {
  const source = await readSource('spriteMood.ts');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('spriteMood must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

// ---------------------------------------------------------------------------
// 1. spriteMood — pure mood → visual mapping (behavioral)
// ---------------------------------------------------------------------------

test('spriteMood maps all nine moods to a complete visual state', async () => {
  const { spriteVisual } = await loadSpriteMood();
  const moods = ['recovery', 'concern', 'celebrate', 'rest', 'streak', 'encourage', 'focused', 'idle', 'unknown'];
  for (const mood of moods) {
    const visual = spriteVisual(mood);
    assert.ok(visual.face, `${mood} must map to a face`);
    assert.ok(['none', 'success', 'warning'].includes(visual.dot), `${mood} dot must use the token palette`);
    assert.ok(['none', 'breath', 'pulse'].includes(visual.motion), `${mood} motion must be one of the two allowed levels`);
    assert.ok(visual.moodLabel.length > 0, `${mood} must have a zh label`);
    assert.match(visual.orbClass, new RegExp(`sprite-orb--${mood}`));
  }
});

test('spriteMood encodes the constitution semantics', async () => {
  const { spriteVisual } = await loadSpriteMood();
  assert.equal(spriteVisual('concern').face, 'worried');
  assert.equal(spriteVisual('concern').dot, 'warning', 'concern is the only warning-tinted state');
  assert.equal(spriteVisual('celebrate').face, 'joy');
  assert.equal(spriteVisual('celebrate').dot, 'success');
  assert.equal(spriteVisual('celebrate').motion, 'pulse', 'celebration is the only pulsing state');
  assert.equal(spriteVisual('focused').motion, 'none', 'focused means stillness');
  assert.equal(spriteVisual('unknown').face, 'curious');
  assert.equal(spriteVisual('streak').face, 'spark');
  assert.equal(spriteVisual('recovery').face, 'welcoming');
});

test('spriteMood falls back to the idle visual for unknown input', async () => {
  const { spriteVisual } = await loadSpriteMood();
  const fallback = spriteVisual('something-else');
  assert.equal(fallback.face, 'breathing');
  assert.equal(fallback.moodLabel, spriteVisual('idle').moodLabel);
});

// ---------------------------------------------------------------------------
// 2. useSpriteState — fetch honesty + lifecycle guards (source contract)
// ---------------------------------------------------------------------------

test('useSpriteState pulls /sprite/state with demo gate, stale guards, account reset, refresh listeners', async () => {
  const source = await readSource('useSpriteState.ts');
  assert.match(source, /fetchWithAuth\(/);
  assert.match(source, /\/sprite\/state/);
  assert.match(source, /isStaticDemoMode\(\)/, 'static demo mode must never hit the API');
  assert.match(source, /cancelled/, 'unmount must cancel stale writes');
  assert.match(source, /requestId/, 'request sequencing must guard against out-of-order responses');
  assert.match(source, /setState\(null\)/, 'account switch must clear state before refetching');
  assert.match(source, /accountKey/);
  assert.match(source, /daily-brief:refresh/, 'task completion must refresh the mood');
  assert.match(source, /'focus'/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /removeEventListener/, 'listeners are cleaned up on unmount');
  assert.match(source, /kaoyan408:sprite\b|spriteMuted|sprite\.muted/, 'mute preference stays client-side');
});

// ---------------------------------------------------------------------------
// 3. SpriteWidget — panel, evidence, actions, mute, a11y (source contract)
// ---------------------------------------------------------------------------

test('SpriteWidget is an ambient surface: demo/failure renders nothing, never an error banner', async () => {
  const source = await readSource('SpriteWidget.tsx');
  assert.match(source, /isStaticDemoMode\(\)/);
  assert.match(source, /return null/, 'demo mode and hard failure render nothing');
  assert.doesNotMatch(source, /ModuleUnavailable|errorMessage|error-banner/, 'ambient surface never becomes an error banner');
});

test('SpriteWidget exposes an accessible orb and dialog panel with evidence expansion', async () => {
  const source = await readSource('SpriteWidget.tsx');
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-label="AI 学习精灵/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /Escape/, 'Escape closes the panel');
  assert.match(source, /依据/, 'every line exposes why it was said');
  assert.match(source, /evidenceRefs/);
  assert.match(source, /location\.hash/, 'deep-link actions navigate via the hash-based router');
  assert.match(source, /toggleMuted|muted/, 'mute preference is wired through the hook (key asserted in the hook test)');
  assert.match(source, /aria-pressed/, 'mute toggle is a pressed-state control');
  assert.match(source, /accountKey/, 'widget resets with the account');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, 'TSX stays hex-free (DESIGN.md §7)');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3}\b/, 'TSX stays hex-free (DESIGN.md §7)');
});

// ---------------------------------------------------------------------------
// 4. App.tsx mount — student-only, hidden during fullscreen sessions
// ---------------------------------------------------------------------------

test('App mounts the sprite for students only and unmounts it during practice/exam sessions', async () => {
  const source = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ SpriteWidget \} from '\.\/features\/sprite\/SpriteWidget';/);
  assert.match(
    source,
    /\(sessionUser\?\.role \?\? 'student'\) === 'student' && !learningSessionType[\s\S]{0,80}<SpriteWidget/,
    'mount condition: student role AND no fullscreen learning session',
  );
  assert.match(source, /accountKey=\{sessionUser\?\.id/);
});

// ---------------------------------------------------------------------------
// 5. sprite.css — token-only, z-ladder, mobile offset, reduced motion
// ---------------------------------------------------------------------------

test('sprite.css consumes semantic tokens only and respects the z/positioning ladder', async () => {
  const source = await readSource('sprite.css');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, 'zero hex colors (DESIGN.md §7)');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3}\b/, 'zero hex colors (DESIGN.md §7)');
  assert.doesNotMatch(source, /rgba?\(/, 'no raw rgb literals — shadows/surfaces come from tokens');
  assert.match(source, /var\(--primary/);
  assert.match(source, /z-index: 60/, 'above bottom nav (40), below fullscreen layers (1000+)');
  assert.match(source, /calc\(84px \+ env\(safe-area-inset-bottom\)/, 'mobile offset clears the bottom nav');
  assert.match(source, /@media \(max-width: 720px\)/, 'primary mobile breakpoint');
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/, 'motion opt-out');
  assert.match(source, /var\(--space-/, 'spacing walks the token ladder');
});

// ---------------------------------------------------------------------------
// V10-3 Companion Loop — daily greeting bubble, completion response, milestones
// ---------------------------------------------------------------------------

test('V10-3 bubble: one proactive touch per natural day, gated by mute, never for idle/focused', async () => {
  const source = await readSource('useSpriteState.ts');
  assert.match(source, /kaoyan408:sprite\.bubble/, 'daily quota lives in localStorage');
  assert.match(source, /spriteDateKey|toLocaleDateString|toISOString/, 'quota uses a natural-day key');

  const widget = await readSource('SpriteWidget.tsx');
  assert.match(widget, /bubble/, 'the widget renders the greeting bubble');
  assert.match(widget, /'idle'/, 'idle excluded from greeting eligibility');
  assert.match(widget, /'focused'/, 'focused sessions never greet');
  assert.match(widget, /setTimeout/, 'the bubble auto-dismisses');
  assert.match(widget, /clearTimeout/, '…and its timer is cleaned up');
  assert.match(widget, /role="status"/, 'the bubble is polite ambient status, not a modal');
  assert.match(widget, /muted/, 'mute gates the bubble immediately');
});

test('V10-3 telemetry: sprite interactions go through the allowlisted sprite.interact type', async () => {
  const widget = await readSource('SpriteWidget.tsx');
  assert.match(widget, /trackEvent\('sprite\.interact'/, 'all sprite telemetry uses the single allowlisted type');
  assert.match(widget, /panel_open/);
  assert.match(widget, /bubble_shown/);
  assert.match(widget, /bubble_click/);
  assert.match(widget, /action_click/);

  const allowlist = await readFile(
    new URL('../apps/api/src/study/canonical-event-writer.service.ts', import.meta.url),
    'utf8',
  );
  assert.match(allowlist, /'sprite\.interact'/, 'sprite.interact is allowlisted for telemetry');
  assert.match(allowlist, /'tutor\.ask'/, 'pre-existing allowlist entries are untouched (no table replacement)');
});

test('V10-3 milestones: the panel shows the achievement strip when evidence exists', async () => {
  const widget = await readSource('SpriteWidget.tsx');
  assert.match(widget, /milestones/);
  assert.match(widget, /成就/, 'achievement strip is user-visible');
});
