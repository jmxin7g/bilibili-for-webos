const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const app = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const report = { date: new Date().toISOString(), result: 'RUNNING' };
await app.reload();
await app.waitForFunction(() => window.showPage && accountIdentity !== undefined, null, { timeout: 45000 });
const keys = await app.evaluate(() => [historyKey(), progressKey('BV1864y1T7Ks'), progressKey('BV1864y1T7Ks', 2), 'test.skipProfilePrompt']);
const saved = await app.evaluate(keys => ({ keys: Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), quality: quality.value }), keys);
try {
  await app.evaluate(() => {
    if (profilePicker.open) profilePicker.close();
    localStorage.setItem('test.skipProfilePrompt', '1');
    localStorage.setItem(progressKey('BV1864y1T7Ks'), '17');
    localStorage.setItem(progressKey('BV1864y1T7Ks', 2), '60');
    window.progressTrace = [];
    video.addEventListener('loadedmetadata', () => {
      window.progressTrace.push({ event: 'metadata', time: video.currentTime, ready: video.readyState, target: seekTarget, page: current.page });
      window.cancelledResume = leavePlayer();
    }, { once: true });
    quality.value = '480'; selectedPart = 2; input.value = 'BV1864y1T7Ks';
  });
  await app.evaluate(() => openVideo());
  report.opened = await app.evaluate(() => ({ status: playerStatus.textContent, home: homeStatus.textContent, errors: current?.errors, trace: window.progressTrace }));
  if (report.opened.errors?.length) throw new Error(report.opened.errors.join('; '));
  if (report.opened.home.startsWith('播放失败')) throw new Error(report.opened.home);
  await app.waitForFunction(() => window.cancelledResume, null, { timeout: 60000 });
  await app.evaluate(() => window.cancelledResume);
  await app.waitForTimeout(500);
  report.state = await app.evaluate(() => ({ trace: window.progressTrace, p1: localStorage.getItem(progressKey('BV1864y1T7Ks')), p2: localStorage.getItem(progressKey('BV1864y1T7Ks', 2)), hidden: player.hidden }));
  assert.equal(report.state.p1, '17');
  assert.equal(report.state.p2, '60', 'cancelling a resume before playback must preserve P2 progress');
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; throw error; }
finally {
  await app.evaluate(async saved => {
    if (!player.hidden) await leavePlayer();
    for (const [k, v] of Object.entries(saved.keys)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
    quality.value = saved.quality;
    delete window.progressTrace; delete window.cancelledResume;
  }, saved);
  await app.reload();
  writeFileSync('output/playwright/simulator-resume-cancel.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await browser.close();
}
