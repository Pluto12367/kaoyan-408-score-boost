import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function read(relativePath) {
  return fs.readFileSync(`${root}${relativePath}`, 'utf8');
}

test('register wizard exposes four profile steps and persists a temporary profile', () => {
  const source = read('apps/web/src/features/auth/RegisterWizard.tsx');
  assert.match(source, /Step \$\{step \+ 1\} \/ 4/);
  assert.match(source, /目标院校/);
  assert.match(source, /数据结构水平/);
  assert.match(source, /每天学习时间/);
  assert.match(read('apps/web/src/features/onboarding/onboardingProfile.ts'), /localStorage/);
  assert.match(source, /创建学习空间/);
});

test('initialization core presents the staged AI activation sequence', () => {
  const source = read('apps/web/src/features/onboarding/InitializationCore.tsx');
  assert.match(source, /正在加载408知识体系/);
  assert.match(source, /正在建立 Student State/);
  assert.match(source, /正在分析知识掌握模型/);
  assert.match(source, /正在生成个性化学习计划/);
  assert.match(source, /AI 学习空间创建完成/);
  assert.match(source, /framer-motion/);
});

test('welcome hero keeps the dashboard as the final destination', () => {
  const source = read('apps/web/src/features/onboarding/WelcomeHero.tsx');
  assert.match(source, /WELCOME TO 408 OS/);
  assert.match(source, /进入学习空间/);
  assert.match(source, /onEnterDashboard/);
});

test('authenticated registration enters initialization without changing auth endpoints', () => {
  const app = read('apps/web/src/App.tsx');
  const auth = read('apps/web/src/hooks/useAuth.ts');
  assert.match(app, /registered/);
  assert.match(app, /InitializationCore|OnboardingFlow/);
  assert.match(auth, /registerAccount/);
  assert.match(auth, /lastAuthAction/);
});
