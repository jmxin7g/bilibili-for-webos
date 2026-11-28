// Recommendation hero: Right past the last button pages forward (wrapping), Left past the first button pages
// back, and Left on the first item opens the sidebar. Some presses use the Simulator remote. Run through
// tools/simulator-test.mjs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const app = pages.find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = pages.find(p => p.url().includes('/screen/rcu/'));
const report = { date: new Date().toISOString(), steps: [], result: 'RUNNING' };
const press = async (key, remote = false) => {
  if (remote) await rcu.locator(`[data-testid="buttonRCU-${key}"]`).click();
  else await app.keyboard.press(key);
  await app.waitForTimeout(400);
  const state = await app.evaluate(() => ({
    index: heroIndex,
    title: document.querySelector('#browse-heading').textContent,
    dot: Array.from(heroDots.children).findIndex(dot => dot.classList.contains('current')),
    focus: document.activeElement.id || document.activeElement.className.toString().slice(0, 20),
    onNav: navItems.includes(document.activeElement),
  }));
  report.steps.push({ key, remote, ...state });
  return state;
};
try {
  await app.evaluate(() => { showPage('browse'); window.scrollTo(0, 0); });
  await app.waitForFunction(() => heroItems.length > 1, null, { timeout: 30000 });
  report.items = await app.evaluate(() => heroItems.length);
  const loggedIn = await app.evaluate(() => !document.querySelector('#logout').hidden);
  await app.evaluate(() => { heroIndex = 0; showHero(heroItems[0]); markHeroDot(); heroPlay.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  const first = await app.evaluate(() => document.querySelector('#browse-heading').textContent);

  let s;
  if (loggedIn) {
    s = await press('ArrowRight', true);
    assert.equal(s.focus, 'hero-later', 'Right from Play reaches +'); assert.equal(s.index, 0);
  }
  s = await press('ArrowRight', true);
  assert.equal(s.index, 1, 'Right past the last button pages forward');
  assert.notEqual(s.title, first, 'hero shows the next item');
  assert.equal(s.dot, 1, 'page dot follows');
  if (loggedIn) {
    assert.equal(s.focus, 'hero-later', 'focus stays on the same button');
    s = await press('ArrowLeft');
    assert.equal(s.focus, 'hero-play', 'Left from + reaches Play'); assert.equal(s.index, 1);
  }
  s = await press('ArrowLeft');
  assert.equal(s.index, 0, 'Left past Play pages back'); assert.equal(s.title, first);
  assert.equal(s.onNav, false);
  s = await press('ArrowLeft', true);
  assert.equal(s.onNav, true, 'Left on the first item opens the sidebar');
  assert.equal(s.index, 0, 'opening the sidebar does not page');
  s = await press('ArrowRight');
  assert.equal(s.onNav, false, 'Right returns into the page');

  // Wrap: Right past the last button on the last item returns to the first item.
  await app.evaluate(() => { heroIndex = heroItems.length - 1; showHero(heroItems[heroIndex]); markHeroDot(); });
  await app.evaluate(() => { const actions = Array.from(document.querySelectorAll('.hero-actions button')).filter(b => !b.hidden); actions[actions.length - 1].focus({ preventScroll: true }); });
  s = await press('ArrowRight');
  assert.equal(s.index, 0, 'Right on the last item wraps to the first');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  await app.evaluate(() => { showPage('browse'); window.scrollTo(0, 0); heroPlay.focus({ preventScroll: true }); }).catch(() => {});
  await writeFile('output/playwright/simulator-hero-keys.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
