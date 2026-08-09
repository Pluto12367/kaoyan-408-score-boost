import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop sidebar stays visible while the document keeps native scrolling', async () => {
  const app = await source('apps/web/src/App.tsx');
  const styles = await source('apps/web/src/styles.css');
  const sidebarRule = styles.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(app, /<div className="sidebar-brand">/);
  assert.match(sidebarRule, /position:\s*sticky;/);
  assert.match(sidebarRule, /top:\s*0;/);
  assert.match(sidebarRule, /align-self:\s*start;/);
  assert.match(sidebarRule, /height:\s*100vh;/);
  assert.match(sidebarRule, /height:\s*100dvh;/);
  assert.match(sidebarRule, /overflow-y:\s*auto;/);
  assert.doesNotMatch(app, /addEventListener\(['"]scroll/);
  assert.doesNotMatch(styles, /\.workspace\s*\{[^}]*height:\s*100(?:d)?vh;[^}]*overflow-y:\s*auto;/);
});

test('tablet uses one sticky horizontally scrollable role navigation row', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  const styles = await source('apps/web/src/styles.css');
  const tabletRule = styles.match(/@media \(min-width:\s*721px\) and \(max-width:\s*900px\) \{\s*\.sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
  const roleNavigationRule = styles.match(/\.sidebar \.role-navigation\s*\{([^}]*)\}/)?.[1] ?? '';
  const roleButtonRule = styles.match(/\.sidebar \.role-navigation button\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(navigation, /<nav className="role-navigation" aria-label=/);
  assert.match(styles, /@media \(min-width:\s*721px\) and \(max-width:\s*900px\)/);
  assert.match(styles, /@media \(min-width:\s*721px\) and \(max-width:\s*900px\) \{[\s\S]*?\.sidebar \{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*30;/);
  assert.match(tabletRule, /min-width:\s*0;/);
  assert.match(tabletRule, /width:\s*100%;/);
  assert.match(tabletRule, /max-width:\s*100%;/);
  assert.doesNotMatch(tabletRule, /max-width:\s*100vw;/);
  assert.match(styles, /\.sidebar-brand \{[\s\S]*?display:\s*none;/);
  assert.match(roleNavigationRule, /display:\s*flex;/);
  assert.match(roleNavigationRule, /overflow-x:\s*auto;/);
  assert.match(roleButtonRule, /flex:\s*0 0 auto;/);
  assert.match(roleButtonRule, /width:\s*auto;/);
  assert.match(roleButtonRule, /white-space:\s*nowrap;/);
});

test('mobile student bottom navigation remains the only sticky student navigation', async () => {
  const styles = await source('apps/web/src/styles.css');

  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /\.sidebar-student \{\s*display:\s*none;/);
  assert.match(styles, /\.bottom-nav \{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/);
});
