import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const app = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
await app.waitForFunction(() => window.serviceBase, null, { timeout: 30000 });
const serviceBase = await app.evaluate(() => window.serviceBase);
const report = { date: new Date().toISOString(), environment: 'Mac webOS Simulator; service from window.serviceBase; focus emulated by runner', bvid: 'BV12ePzeoE1Z', qn: 125, result: 'RUNNING', phase: 'startup', samples: [], transfers: [] };
const duration = Number(process.env.OBSERVE_MS || 30000);
const out = process.env.OUT || 'output/playwright/simulator-hdr.json';
const session = await app.context().newCDPSession(app);
await session.send('Network.enable');
const transfers = new Map();
session.on('Network.requestWillBeSent', event => {
  if (!event.request.url.startsWith(`${serviceBase}/media/`)) return;
  const item = { range: event.request.headers.Range || event.request.headers.range, start: event.timestamp, last: event.timestamp, bytes: 0, maxGap: 0 };
  transfers.set(event.requestId, item); report.transfers.push(item);
});
session.on('Network.responseReceived', event => {
  const item = transfers.get(event.requestId);
  if (item) { item.status = event.response.status; item.host = event.response.headers['X-Media-Source']; item.ttfb = event.timestamp - item.start; }
});
session.on('Network.dataReceived', event => {
  const item = transfers.get(event.requestId);
  if (item) { item.maxGap = Math.max(item.maxGap, event.timestamp - item.last); item.last = event.timestamp; item.bytes += event.dataLength; }
});
session.on('Network.loadingFinished', event => {
  const item = transfers.get(event.requestId);
  if (item) { item.seconds = event.timestamp - item.start; item.complete = true; }
});
session.on('Network.loadingFailed', event => {
  const item = transfers.get(event.requestId);
  if (item) { item.seconds = event.timestamp - item.start; item.error = event.errorText; item.phase = report.phase; }
});
const state = () => app.evaluate(() => ({
  at: Date.now(), time: video.currentTime, qn: current?.quality, width: video.videoWidth, height: video.videoHeight,
  paused: video.paused, ready: video.readyState, status: playerStatus.textContent, errors: current?.errors || [],
  mediaError: video.error?.code ?? null, buffered: dashPlayer.getBufferedInfo(), buffering: dashPlayer.isBuffering(),
  tracks: dashPlayer.getVariantTracks().filter(track => track.active).map(track => ({ bandwidth: track.bandwidth, codec: track.videoCodec })),
  stats: dashPlayer.getStats(),
}));
try {
  await app.reload();
  await app.waitForFunction(() => window.showPage);
  await app.evaluate(bvid => {
    if (profilePicker.open) profilePicker.close();
    localStorage.removeItem(`progress:${bvid}`);
    quality.value = 'qn:125'; input.value = bvid; selectedPart = 1;
    window.hdrBufferEvents = [];
    window.hdrBufferListener = event => hdrBufferEvents.push({ at: Date.now(), time: video.currentTime, buffering: event.buffering, buffered: dashPlayer.getBufferedInfo() });
    dashPlayer.addEventListener('buffering', hdrBufferListener);
    void openVideo();
  }, report.bvid);
  await app.waitForFunction(() => current?.errors.length || (current?.quality === 125 && video.readyState >= 3 && !video.paused && !dashPlayer.isBuffering() && video.currentTime > 0.05), null, { polling: 100, timeout: 60000 });
  report.initial = await state();
  assert.deepEqual(report.initial.errors, []);
  assert.equal(report.initial.qn, 125);
  assert.equal(report.initial.width, 3840);
  report.phase = 'observing';
  const start = Date.now();
  while (Date.now() - start < duration) {
    await app.waitForTimeout(1000);
    const sample = await state(); report.samples.push(sample);
    if (sample.errors.length || sample.mediaError !== null) break;
  }
  report.final = await state();
  report.fluency = {
    seconds: (report.final.at - report.initial.at) / 1000,
    progressed: report.final.time - report.initial.time,
    buffering: report.final.stats.bufferingTime - report.initial.stats.bufferingTime,
    drops: report.final.stats.droppedFrames - report.initial.stats.droppedFrames,
    frames: report.final.stats.decodedFrames - report.initial.stats.decodedFrames,
  };
  assert.deepEqual(report.final.errors, []);
  assert.equal(report.final.mediaError, null);
  assert.ok(report.fluency.progressed >= report.fluency.seconds * 0.95, 'media time must advance at least 95% of observation');
  assert.ok(report.fluency.buffering < 0.05, 'playback must not rebuffer');
  assert.ok(report.fluency.frames > 0 && report.fluency.drops / report.fluency.frames < 0.01, 'dropped frames must remain below 1%');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message;
  report.final = await state();
  throw error;
} finally {
  report.bufferingEvents = await app.evaluate(() => {
    dashPlayer.removeEventListener('buffering', window.hdrBufferListener);
    const events = window.hdrBufferEvents;
    delete window.hdrBufferListener; delete window.hdrBufferEvents;
    return events;
  });
  report.phase = 'cleanup';
  await mkdir('output/playwright', { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, error: report.error, fluency: report.fluency, final: { qn: report.final?.qn, width: report.final?.width, time: report.final?.time, status: report.final?.status }, out }));
  await session.detach();
  await browser.close();
}
