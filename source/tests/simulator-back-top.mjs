// Back on a scrolled page returns to its top (focus on the page's first control) without opening the sidebar;
// Back again at the top opens the sidebar. One page uses the Simulator remote's real Back key.
// Run through tools/simulator-test.mjs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const app = pages.find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = pages.find(p => p.url().includes('/screen/rcu/'));
const report = { date: new Date().toISOString(), pages: {}, result: 'RUNNING' };
const back = async useRemote => {
  if (useRemote) await rcu.locator('[data-testid="buttonRCU-Back"]').click();
  else await app.keyboard.press('Escape');
  await app.waitForTimeout(600);
};
const snapshot = () => app.evaluate(() => ({
  scrollY: Math.round(window.scrollY),
  away: awayFromPageTop(),
  onNav: navItems.includes(document.activeElement),
  isTopTarget: document.activeElement === pageTopTarget(),
  active: (document.activeElement.id || document.activeElement.className.toString().slice(0, 30)) + '|' + document.activeElement.textContent.trim().slice(0, 10),
  topVisible: document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().bottom <= innerHeight,
}));
try {
  const cases = [['browse', false], ['popular', true], ['following', false], ['regions', false], ['settings', false]];
  for (const [name, useRemote] of cases) {
    await app.evaluate(n => { window.scrollTo(0, 0); showPage(n); }, name);
    await app.waitForFunction(() => pageFocusables().length > 4, null, { timeout: 30000 });
    await app.waitForTimeout(800);
    // Go deep: focus the last control on the page so it scrolls down.
    await app.evaluate(() => { const t = pageFocusables(); t[t.length - 1].focus(); });
    await app.waitForTimeout(600);
    const deep = await snapshot();
    assert.equal(deep.away, true, `${name}: test setup scrolled away from the top`);
    await back(useRemote);
    const first = await snapshot();
    await back(useRemote);
    const second = await snapshot();
    report.pages[name] = { remote: useRemote, deep, first, second };
    assert.equal(first.scrollY, 0, `${name}: first Back scrolls to top`);
    assert.equal(first.away, false, `${name}: page (and any inner list) back at the top`);
    assert.equal(first.onNav, false, `${name}: first Back does not open the sidebar`);
    assert.equal(first.isTopTarget, true, `${name}: focus on the page's top control`);
    assert.equal(first.topVisible, true, `${name}: focused control visible`);
    assert.equal(second.onNav, true, `${name}: second Back opens the sidebar`);
    await app.keyboard.press('ArrowRight'); // back into the page
    await app.waitForTimeout(400);
  }
  // At the top already: one Back opens the sidebar straight away.
  await app.evaluate(() => { showPage('popular'); window.scrollTo(0, 0); pageFocusables()[0].focus({ preventScroll: true }); window.scrollTo(0, 0); });
  await app.waitForTimeout(400);
  await back(false);
  report.atTop = await snapshot();
  assert.equal(report.atTop.onNav, true, 'at the top, Back opens the sidebar');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  await app.evaluate(() => { showPage('browse'); window.scrollTo(0, 0); }).catch(() => {});
  await writeFile('output/playwright/simulator-back-top.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
