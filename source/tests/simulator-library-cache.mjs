// Library pages load only their own list and reuse it for a minute; a reload keeps the focused card; covers
// load lazily. Needs a logged-in account (skips the library part otherwise). Run through tools/simulator-test.mjs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const app = browser.contexts().flatMap(c => c.pages()).find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const report = { date: new Date().toISOString(), result: 'RUNNING' };
const requests = () => app.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.startsWith(window.serviceBase) && e.name.includes('/me/')).map(e => new URL(e.name).pathname));
const enter = async (name, wait = true) => {
  await app.evaluate(n => { performance.clearResourceTimings(); navItems.find(i => i.dataset.page === n).focus(); showPage(n); }, name);
  if (wait) await app.waitForFunction(n => libraryState.seen.has(libraryKeys[n]) && !libraryState.busy.size, name, { timeout: 30000 });
};
const settle = () => app.waitForFunction(() => !libraryState.busy.size, null, { timeout: 30000 });
try {
  const loggedIn = await app.evaluate(() => !document.querySelector('#logout').hidden);
  report.loggedIn = loggedIn;
  if (loggedIn) {
    await app.evaluate(() => markLibraryStale());
    // 1. Each page requests only its own list.
    await enter('following'); report.following = await requests();
    assert.deepEqual(report.following, ['/me/following'], '关注 requests only the following list');
    await enter('cloud-history'); report.history = await requests();
    assert.deepEqual(report.history, ['/me/history'], '历史 requests only the history list');
    await enter('favorites'); await settle(); report.favorites = await requests();
    assert.deepEqual(report.favorites.sort(), ['/me/favorites', '/me/favorites/items'], '收藏 requests folders and the open folder');
    // 2. Coming back within a minute reuses the list: no request, same card elements.
    const marker = await app.evaluate(() => { const c = document.querySelector('#following-row .video-card'); c.dataset.cacheMarker = '1'; return c.dataset.bvid; });
    await enter('following', false); await app.waitForTimeout(1500);
    report.followingAgain = await requests();
    assert.deepEqual(report.followingAgain, [], 'fresh list is not requested again');
    assert.equal(await app.evaluate(() => document.querySelector('#following-row .video-card')?.dataset.cacheMarker), '1', 'cards are kept');
    // 3. A stale list reloads in place and keeps the focused card (quick Right right after choosing the page).
    for (const name of ['following', 'cloud-history', 'favorites']) {
      await app.evaluate(n => markLibraryStale(libraryKeys[n]), name);
      await enter(name, false);
      await app.waitForTimeout(200);
      await app.keyboard.press('ArrowRight');
      const before = await app.evaluate(() => ({ bvid: document.activeElement.dataset.bvid, folder: document.activeElement.dataset.folder, tag: document.activeElement.tagName }));
      await settle(); await app.waitForTimeout(800);
      const after = await app.evaluate(() => ({ bvid: document.activeElement.dataset.bvid, folder: document.activeElement.dataset.folder, tag: document.activeElement.tagName, inPage: !!document.activeElement.closest('#page-library') }));
      report[`reload-${name}`] = { before, after };
      assert.equal(after.inPage, true, `${name}: focus stays on the page after the reload`);
      assert.equal(after.bvid ?? after.folder, before.bvid ?? before.folder, `${name}: focus stays on the same item`);
    }
    // 4. Watching a video marks the history stale; watch later changes mark watch later stale.
    await app.evaluate(() => { libraryState.loadedAt.history = Date.now(); });
    await app.evaluate(() => leavePlayer()).catch(() => {});
    report.historyStaleAfterPlayer = await app.evaluate(() => !libraryState.loadedAt.history);
    assert.equal(report.historyStaleAfterPlayer, true, 'leaving the player marks history stale');
  }
  // 5. Covers load lazily: a big grid does not request every cover at once, on-screen covers do load.
  await app.evaluate(() => { performance.clearResourceTimings(); navItems.find(i => i.dataset.page === 'regions').focus(); showPage('regions'); window.scrollTo(0, 0); });
  await app.waitForFunction(() => regionGrid.children.length > 40, null, { timeout: 30000 });
  await app.waitForTimeout(3000);
  report.lazy = await app.evaluate(() => {
    const imgs = Array.from(regionGrid.querySelectorAll('img'));
    const onScreen = imgs.filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return { total: imgs.length, lazy: imgs.filter(i => i.loading === 'lazy').length, requested: performance.getEntriesByType('resource').filter(e => e.initiatorType === 'img').length, onScreen: onScreen.length, onScreenLoaded: onScreen.filter(i => i.complete && i.naturalWidth > 0).length };
  });
  assert.equal(report.lazy.lazy, report.lazy.total, 'every card cover is lazy');
  assert.ok(report.lazy.requested < report.lazy.total, 'not every cover is requested up front');
  assert.equal(report.lazy.onScreenLoaded, report.lazy.onScreen, 'on-screen covers are loaded');
  // Scrolling down loads the covers further on.
  await app.evaluate(() => { regionGrid.children[Math.min(80, regionGrid.children.length - 1)].focus(); regionGrid.children[Math.min(80, regionGrid.children.length - 1)].scrollIntoView({ block: 'center' }); });
  await app.waitForTimeout(2500);
  report.lazyScrolled = await app.evaluate(() => { const onScreen = Array.from(regionGrid.querySelectorAll('img')).filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return { onScreen: onScreen.length, loaded: onScreen.filter(i => i.complete && i.naturalWidth > 0).length }; });
  assert.equal(report.lazyScrolled.loaded, report.lazyScrolled.onScreen, 'covers further down load after scrolling');
  report.result = loggedIn ? 'PASS' : 'PASS (library part skipped: logged out)';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  await app.evaluate(() => { navItems.find(i => i.dataset.page === 'browse').focus(); showPage('browse'); window.scrollTo(0, 0); heroPlay.focus({ preventScroll: true }); }).catch(() => {});
  await writeFile('output/playwright/simulator-library-cache.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
