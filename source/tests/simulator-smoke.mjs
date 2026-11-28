import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Connect to the actual Simulator app, without changing its viewport.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
assert.ok(page, 'Start the independent app in Simulator with debugging port 9226');
const report = { date: new Date().toISOString(), environment: 'webOS Simulator via CDP', result: 'RUNNING' };
const previousQuality = await page.locator('#quality').inputValue();
try {
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible', 'Bring Simulator to the foreground');
  if (await page.locator('#player').evaluate(element => !element.hidden)) await page.evaluate(() => leavePlayer());
  await page.waitForFunction(() => document.querySelector('#video-grid').children.length > 0 && document.querySelector('#recommend-grid').children.length > 0, null, { timeout: 60000 });
  // Apple TV sidebar: OK on an entry switches to that page (moving the highlight alone does not).
  await page.locator('.nav-item[data-page="search"]').focus();
  await page.keyboard.press('Enter');
  // The search page opens on its keyboard, or on the control last selected there (this test does not reload).
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#page-search')), true);
  await page.locator('#search-input').fill('Linksphotograph');
  await page.locator('#search-form button').click();
  await page.waitForFunction(() => document.querySelector('#search-grid').children.length > 0, null, { timeout: 60000 });
  report.searchCount = await page.locator('#search-grid > button').count();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.page), 'search');
  await page.locator('.nav-item[data-page="settings"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#quality').selectOption('360');
  await page.evaluate(() => { input.value = 'BV1fwEwzeEPp'; });
  await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
  await page.waitForFunction(() => !document.querySelector('#player').hidden && video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
  report.start = await page.evaluate(() => ({ time: video.currentTime, width: video.videoWidth, height: video.videoHeight }));
  await page.waitForFunction(time => video.currentTime > time + 3, report.start.time, { timeout: 15000 });
  await page.evaluate(() => video.pause());
  report.end = await page.evaluate(() => ({ time: video.currentTime, mediaError: video.error?.code ?? null, errors: current.errors.length }));
  assert.equal(report.end.mediaError, null);
  assert.equal(report.end.errors, 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => overlay.hidden && !player.hidden), true, 'Back hides visible controls');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#player').hidden);
  // Playback was started programmatically (the BV field is internal); focus returns to a visible control.
  assert.equal(await page.evaluate(() => document.activeElement !== document.body && document.activeElement.getClientRects().length > 0), true);
  assert.ok(await page.evaluate(() => readHistory().some(item => item.bvid === 'BV1fwEwzeEPp' && item.position > 0)));
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message.split('\n')[0];
  throw error;
} finally {
  await page.evaluate(value => { quality.value = value; quality.dispatchEvent(new Event('change')); }, previousQuality);
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/simulator-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
