import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const session = await page.context().newCDPSession(page);
const report = { date: new Date().toISOString(), result: 'RUNNING', samples: [], phases: [] };
const sample = () => page.evaluate(() => ({
  time: video.currentTime, quality: current?.quality, label: qualitySwitch.textContent,
  active: dashPlayer.getVariantTracks().filter(track => track.active).map(track => ({ id: track.originalVideoId, bandwidth: track.bandwidth })),
  estimate: dashPlayer.getStats().estimatedBandwidth, buffering: dashPlayer.isBuffering(), errors: current?.errors || [],
}));
const until = async (phase, condition, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await sample(); report.samples.push({ phase, ...state });
    assert.deepEqual(state.errors, []);
    if (condition(state)) { report.phases.push({ phase, ...state }); return state; }
    await page.waitForTimeout(1000);
  }
  throw new Error(`${phase}: adaptive quality did not reach the expected state`);
};
try {
  await session.send('Network.enable');
  await page.reload(); await page.waitForFunction(() => window.showPage && accountIdentity !== undefined);
  await page.evaluate(() => {
    if (profilePicker.open) profilePicker.close();
    quality.value = 'auto'; input.value = 'BV1XypX6aEfV'; selectedPart = 1;
    localStorage.removeItem(progressKey('BV1XypX6aEfV'));
    void openVideo();
  });
  const initial = await until('initial', state => state.time > 1 && state.quality >= 64);
  const tracks = await page.evaluate(() => dashPlayer.getVariantTracks().map(track => ({ quality: track.originalVideoId, bandwidth: track.bandwidth })));
  assert.ok(new Set(tracks.map(track => track.quality.split('-')[0])).size > 1);
  report.tracks = tracks;
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 30, downloadThroughput: 75000, uploadThroughput: -1 });
  const low = await until('slow-600kbps', state => state.quality < initial.quality);
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const high = await until('recovered', state => state.quality > low.quality && state.time > low.time + 1);
  assert.ok(high.label.startsWith('自动 · '));
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; throw error; }
finally {
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await session.send('Network.disable'); await session.detach();
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/simulator-auto.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, phases: report.phases, error: report.error }));
  await browser.close();
}
