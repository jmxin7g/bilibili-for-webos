const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const app = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const report = { date: new Date().toISOString(), result: 'RUNNING' };
const keys = await app.evaluate(() => [historyKey(), progressKey('BV1864y1T7Ks'), progressKey('BV1864y1T7Ks', 2), 'test.skipProfilePrompt']);
const saved = await app.evaluate(keys => ({ keys: Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), quality: quality.value }), keys);
try {
  await app.evaluate(() => {
    if (profilePicker.open) profilePicker.close();
    localStorage.setItem('test.skipProfilePrompt', '1');
    localStorage.setItem(progressKey('BV1864y1T7Ks'), '17');
    localStorage.setItem(progressKey('BV1864y1T7Ks', 2), '60');
    quality.value = '480'; selectedPart = 2; input.value = 'BV1864y1T7Ks';
  });
  await app.evaluate(() => openVideo());
  await app.waitForFunction(() => progressReady && video.currentTime >= 60 && !video.paused, null, { timeout: 60000 });
  report.resumed = await app.evaluate(() => ({ page: current.page, time: video.currentTime, format: current.format, errors: current.errors }));
  assert.equal(report.resumed.page, 2); assert.deepEqual(report.resumed.errors, []);
  await app.evaluate(() => { video.pause(); video.currentTime = 90; });
  await app.waitForFunction(() => !video.seeking && video.readyState >= 2, null, { timeout: 60000 });
  await app.evaluate(() => leavePlayer());
  await app.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await app.reload();
  await app.waitForFunction(() => window.showPage && accountIdentity !== undefined, null, { timeout: 45000 });
  report.persisted = await app.evaluate(() => ({ p1: localStorage.getItem(progressKey('BV1864y1T7Ks')), p2: localStorage.getItem(progressKey('BV1864y1T7Ks', 2)), history: JSON.parse(localStorage.getItem(historyKey())).find(x => x.bvid === 'BV1864y1T7Ks') }));
  assert.equal(report.persisted.p1, '17'); assert.equal(report.persisted.p2, '90');
  assert.equal(report.persisted.history.page, 2); assert.equal(report.persisted.history.position, 90);
  await app.evaluate(() => { if (profilePicker.open) profilePicker.close(); quality.value = '480'; selectedPart = 2; input.value = 'BV1864y1T7Ks'; });
  await app.evaluate(() => openVideo());
  await app.waitForFunction(() => progressReady && video.currentTime >= 90 && !video.paused, null, { timeout: 60000 });
  report.reopened = await app.evaluate(() => ({ page: current.page, time: video.currentTime, errors: current.errors }));
  assert.equal(report.reopened.page, 2); assert.deepEqual(report.reopened.errors, []);
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; throw error; }
finally {
  await app.evaluate(async saved => {
    if (!player.hidden) await leavePlayer();
    for (const [k, v] of Object.entries(saved.keys)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
    quality.value = saved.quality;
  }, saved);
  await app.reload();
  writeFileSync('output/playwright/simulator-resume.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await browser.close();
}
