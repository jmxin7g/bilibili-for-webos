const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
await page.waitForFunction(() => window.serviceBase, null, { timeout: 30000 });
const serviceBase = await page.evaluate(() => window.serviceBase);
const report = { date: new Date().toISOString(), scenario: 'DASH timeout event during pending native play; original error must stay visible' };
try {
  await page.reload();
  await page.waitForFunction(() => window.showPage);
  if (await page.locator('#player').evaluate(element => !element.hidden)) await page.evaluate(() => leavePlayer());
  await page.evaluate(() => showPage('settings'));
  await page.locator('#quality').selectOption('1080');
  await page.route(`${serviceBase}/media/**`, async route => {
    const match = route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/);
    if (match && Number(match[2]) - Number(match[1]) > 10000) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      await route.abort();
    } else await route.continue();
  });
  await page.evaluate(() => {
    const injectError = () => {
      dashPlayer.removeEventListener('loaded', injectError);
      setTimeout(() => {
        window.errorTriggerState = { ready: video.readyState, paused: video.paused, generation: playbackGeneration };
        dashPlayer.dispatchEvent(new shaka.util.FakeEvent('error', { detail: new shaka.util.Error(shaka.util.Error.Severity.CRITICAL, shaka.util.Error.Category.NETWORK, shaka.util.Error.Code.TIMEOUT) }));
      }, 0);
    };
    dashPlayer.addEventListener('loaded', injectError);
  });
  await page.evaluate(() => start.click()); // the BV field is internal now; submit as the app does
  await page.waitForFunction(() => current?.errors.length > 0, null, { timeout: 30000 });
  await new Promise(resolve => setTimeout(resolve, 1000));
  report.state = await page.evaluate(() => ({ trigger: window.errorTriggerState, generation: playbackGeneration, status: playerStatus.textContent, errors: current.errors, paused: video.paused, retryHidden: playerRetry.hidden }));
  assert.equal(report.state.trigger.paused, false);
  assert.ok(report.state.trigger.ready < 3);
  assert.equal(report.state.trigger.generation, report.state.generation);
  assert.equal(report.state.status, report.state.errors[0]);
  assert.equal(report.state.errors.length, 1);
  assert.equal(report.state.paused, true);
  assert.equal(report.state.retryHidden, false);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0];
  throw error;
} finally {
  await writeFile('output/playwright/dash-error-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await page.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
