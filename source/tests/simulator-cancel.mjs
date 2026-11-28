import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
await page.waitForFunction(() => window.serviceBase, null, { timeout: 30000 });
const serviceBase = await page.evaluate(() => window.serviceBase);
assert.ok(page, 'Start the independent app in Simulator with debugging port 9226');
const report = { date: new Date().toISOString(), scenarios: [] };
const previousQuality = await page.locator('#quality').inputValue();
const previousProfilePrompt = await page.evaluate(() => localStorage.getItem('test.skipProfilePrompt'));
let release;
try {
  await page.evaluate(() => localStorage.setItem('test.skipProfilePrompt', '1'));
  for (const scenario of [
    { route: '/resolve?**', quality: '360', stage: 'Video API' },
    { route: '/media/**', quality: '360', stage: 'MP4 media' },
    { route: '/manifest/**', quality: '1080', stage: 'DASH manifest' },
  ]) {
    await page.reload();
    await page.waitForFunction(() => window.showPage);
    await page.evaluate(() => showPage('settings'));
    let intercepted = false;
    const held = new Promise(resolve => { release = resolve; });
    const pattern = `${serviceBase}${scenario.route}`;
    await page.route(pattern, async route => {
      if (intercepted) { await route.continue(); return; }
      intercepted = true;
      await held;
      await route.continue();
    });
    // Focus alone no longer switches pages (Apple TV sidebar); open 设置 explicitly.
    await page.locator('.nav-item[data-page="settings"]').focus(); await page.evaluate(() => showPage('settings'));
    await page.locator('#quality').selectOption(scenario.quality);
    await page.evaluate(() => { input.value = 'BV1fwEwzeEPp'; });
    const requested = page.waitForRequest(pattern);
    await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
    await requested;
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !player.hidden && overlay.hidden)) await page.keyboard.press('Escape');
    await page.waitForFunction(() => player.hidden && !start.disabled);
    const cancelled = await page.evaluate(() => ({
      hidden: player.hidden, paused: video.paused, focus: document.activeElement.id || document.activeElement.dataset.page,
      errors: current?.errors ?? [], status: homeStatus.textContent,
    }));
    assert.equal(cancelled.paused, true);
    assert.equal(cancelled.status, '');
    assert.equal(cancelled.errors.length, 0);
    // The hidden internal start button cannot hold focus; the 设置 entry or the row that was focused does.
    assert.ok(cancelled.focus && cancelled.focus !== 'start', `focus after cancel: ${cancelled.focus}`);
    // Start a new request before releasing the obsolete request.
    await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
    await page.waitForFunction(() => video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
    const generation = await page.evaluate(() => playbackGeneration);
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await page.waitForFunction(() => !start.disabled);
    const reopened = await page.evaluate(() => ({
      generation: playbackGeneration, hidden: player.hidden, paused: video.paused,
      width: video.videoWidth, height: video.videoHeight, errors: current.errors,
    }));
    assert.equal(reopened.generation, generation);
    assert.equal(reopened.hidden, false);
    assert.equal(reopened.paused, false);
    assert.ok(reopened.width > 0);
    assert.equal(reopened.errors.length, 0);
    report.scenarios.push({ stage: scenario.stage, cancelled, reopened });
    await page.evaluate(() => leavePlayer());
    await page.waitForFunction(() => player.hidden);
  }
  // A cancelled retry must settle before a new pending resolve can be enabled.
  await page.reload();
  await page.waitForFunction(() => window.showPage);
  await page.evaluate(() => showPage('settings'));
  await page.locator('#quality').selectOption('360');
  await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
  await page.waitForFunction(() => video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
  await page.evaluate(() => showError(new Error('Injected retry cancellation scenario')));
  let releaseRetry;
  const retryHeld = new Promise(resolve => { releaseRetry = resolve; });
  const nextHeld = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route(`${serviceBase}/resolve?**`, async route => {
    const retry = ++requests === 1;
    await (retry ? retryHeld : nextHeld);
    await route.continue();
  });
  try {
    const retryRequested = page.waitForRequest(`${serviceBase}/resolve?**`);
    await page.evaluate(() => {
      window.retryComplete = false;
      retryPlayback().then(() => { window.retryComplete = true; });
    });
    await retryRequested;
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !player.hidden && overlay.hidden)) await page.keyboard.press('Escape');
    await page.waitForFunction(() => player.hidden && !start.disabled);
    const nextRequested = page.waitForRequest(`${serviceBase}/resolve?**`);
    await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
    await nextRequested;
    releaseRetry();
    await page.waitForFunction(() => window.retryComplete);
    assert.equal(await page.locator('#start').isDisabled(), true, 'Obsolete retry must not enable the new pending request');
    release();
    await page.waitForFunction(() => video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => current.errors.length), 0);
    report.scenarios.push({ stage: 'Retry API', pendingButtonDisabled: true, reopened: true });
    await page.evaluate(() => leavePlayer());
    await page.waitForFunction(() => player.hidden);
  } finally {
    releaseRetry();
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message.split('\n')[0];
  throw error;
} finally {
  await page.evaluate(value => {
    if (value === null) localStorage.removeItem('test.skipProfilePrompt');
    else localStorage.setItem('test.skipProfilePrompt', value);
  }, previousProfilePrompt);
  release?.();
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(value => { quality.value = value; quality.dispatchEvent(new Event('change')); }, previousQuality);
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/simulator-cancel.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
