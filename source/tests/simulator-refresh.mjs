import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
assert.ok(page, 'Start the independent app in Simulator on port 9226');
try {
  await page.reload();
  await page.waitForFunction(() => window.showPage && typeof recommendBusy !== 'undefined' && !recommendBusy);
  await page.evaluate(() => {
    if (profilePicker.open) profilePicker.close();
    window.refreshAudit = [];
    window.originalRefreshRequest = serviceRequest;
    serviceRequest = async path => {
      if (path.startsWith('/recommend?')) {
        refreshAudit.push(path);
        return { items: Array.from({ length: 30 }, (_, i) => ({ bvid: `BVrefresh${refreshAudit.length}${i}`, title: '刷新验证', owner: '测试', duration: 10 })) };
      }
      return originalRefreshRequest(path);
    };
    showPage('popular');
    document.querySelector('.nav-item[data-page="browse"]').focus({ preventScroll: true });
  });
  assert.equal(await page.locator('#page-refresh').count(), 0);
  assert.equal(await page.evaluate(() => refreshAudit.length), 0);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !recommendBusy && refreshAudit.length === 1);
  assert.equal(await page.evaluate(() => activePage), 'browse');
  await page.evaluate(() => document.querySelector('.nav-item[data-page="browse"]').focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !recommendBusy && refreshAudit.length === 2);
  assert.equal(await page.evaluate(() => document.querySelector('#hero').classList.contains('loading')), false);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.page')?.id), 'page-browse');
  console.log('PASS: recommendation entry refreshes on reentry and repeated OK; no refresh button or loading residue');
} finally {
  await page.evaluate(() => { if (window.originalRefreshRequest) serviceRequest = originalRefreshRequest; });
  await page.reload();
  await browser.close();
}
