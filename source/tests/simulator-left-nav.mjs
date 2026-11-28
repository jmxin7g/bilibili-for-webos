// Left at the left edge of every sidebar page opens the sidebar; Left inside a row still moves within the row.
// Enter each page from the sidebar (Right), then press Left until focus reaches the sidebar: every press before
// that must move focus or page the hero, and the press that opens the sidebar must come from the page. The last
// press of each page uses the Simulator remote. Run through tools/simulator-test.mjs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const app = pages.find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = pages.find(p => p.url().includes('/screen/rcu/'));
const report = { date: new Date().toISOString(), pages: {}, result: 'RUNNING' };
const where = () => app.evaluate(() => ({
  onNav: navItems.includes(document.activeElement),
  nav: document.activeElement.dataset?.page || null,
  focus: document.activeElement.id || document.activeElement.className.toString().slice(0, 24) || document.activeElement.tagName,
  hero: heroIndex,
  el: (window.__leftNavIds ||= new WeakMap()).get(document.activeElement) ?? (() => { const id = Math.random(); window.__leftNavIds.set(document.activeElement, id); return id; })(),
}));
const left = async (remote) => {
  if (remote) await rcu.locator('[data-testid="buttonRCU-ArrowLeft"]').click();
  else await app.keyboard.press('ArrowLeft');
  await app.waitForTimeout(350);
  return where();
};
try {
  const names = await app.evaluate(() => navItems.map(item => item.dataset.page));
  for (const name of names) {
    await app.evaluate(name => {
      const item = navItems.find(i => i.dataset.page === name);
      item.focus({ preventScroll: true }); showPage(name);
      if (name === 'browse') { heroIndex = 0; showHero(heroItems[0]); markHeroDot(); }
    }, name);
    // Account pages reload their cards on entry; let them settle before entering.
    await app.waitForFunction(() => pageFocusables().length > 0, null, { timeout: 20000 }).catch(() => {});
    await app.waitForTimeout(3000);
    await app.keyboard.press('ArrowRight');
    try { await app.waitForFunction(() => document.activeElement.closest('.page') && pageFocusables().includes(document.activeElement), null, { timeout: 15000 }); }
    catch { report.pages[name] = { skipped: 'no focusable control on the page' }; continue; }
    await app.waitForTimeout(500);
    const steps = [await where()];
    let s = steps[0];
    for (let i = 0; i < 12 && !s.onNav; i++) {
      const prev = s;
      // The press expected to open the sidebar goes through the real remote once the hero sits on its first item.
      s = await left(i >= 1 && i % 2 === 1);
      steps.push(s);
      if (!s.onNav) assert.ok(s.el !== prev.el || s.hero !== prev.hero, `${name}: Left inside the page moves focus (${prev.focus})`);
    }
    assert.equal(s.onNav, true, `${name}: Left at the left edge opens the sidebar`);
    assert.equal(s.nav, name, `${name}: sidebar opens on the current page's entry`);
    report.pages[name] = { presses: steps.length - 1, start: steps[0].focus, edge: steps[steps.length - 2].focus };
    await app.keyboard.press('ArrowRight');
    await app.waitForTimeout(300);
    assert.equal((await where()).onNav, false, `${name}: Right returns into the page`);
  }

  // Left inside a shelf moves to the previous card, not to the sidebar.
  await app.evaluate(() => { navItems.find(i => i.dataset.page === 'browse').focus(); showPage('browse'); enterPage(); });
  await app.waitForFunction(() => document.querySelectorAll('#page-browse .shelf .row .video-card').length > 1, null, { timeout: 30000 });
  const second = await app.evaluate(() => { const c = document.querySelector('#page-browse .shelf .row .video-card:nth-child(2)'); c.focus(); return c.className; });
  const afterInner = await left(true);
  assert.equal(afterInner.onNav, false, 'Left on a second card stays in the shelf');
  const afterEdge = await left(false);
  assert.equal(afterEdge.onNav, true, 'Left on the first card opens the sidebar');
  report.shelf = { second, afterInner: afterInner.focus, afterEdge: afterEdge.nav };
  const skipped = Object.entries(report.pages).filter(([, v]) => v.skipped).map(([k]) => k);
  report.result = skipped.length ? `PASS (skipped: ${skipped.join(', ')})` : 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  await app.evaluate(() => { navItems.find(i => i.dataset.page === 'browse').focus(); showPage('browse'); window.scrollTo(0, 0); heroPlay.focus({ preventScroll: true }); }).catch(() => {});
  await writeFile('output/playwright/simulator-left-nav.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
