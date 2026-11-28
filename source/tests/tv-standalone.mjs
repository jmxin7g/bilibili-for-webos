import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP(process.env.TV_CDP, { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().includes('com.jinmx.independent.playback'));
assert.ok(page, 'Launch this app on the TV and establish ares-inspect first');
const report = { date: new Date().toISOString(), environment: 'LG OLED65G6PJB, TV built-in service, Mac backend stopped', result: 'RUNNING', api: [], samples: [], requests: [], failures: [] };
const cdp = await page.context().newCDPSession(page);
const hosts = new Map();
await cdp.send('Network.enable');
cdp.on('Network.requestWillBeSent', event => {
  const address = new URL(event.request.url);
  hosts.set(event.requestId, address.hostname);
  // Never save the query, cookies, QR key, local session token or media signatures.
  report.requests.push({ host: address.hostname, route: address.hostname === '127.0.0.1' ? address.pathname.split('/')[1] : 'external' });
});
cdp.on('Network.responseReceived', event => {
  if (event.response.status >= 400) report.failures.push({ host: hosts.get(event.requestId), status: event.response.status });
});
cdp.on('Network.loadingFailed', event => { if (!event.canceled) report.failures.push({ host: hosts.get(event.requestId), error: event.errorText }); });
await mkdir('output', { recursive: true });
const output = process.env.TV_OBSERVE_ONLY ? 'output/tv-long-playback.json' : 'output/tv-standalone.json';
try {
  await page.waitForFunction(() => typeof window.serviceRequest === 'function' && window.serviceBase === 'http://127.0.0.1:8769', null, { timeout: 45000 });
  if (!process.env.TV_OBSERVE_ONLY) {
  report.account = await page.evaluate(async () => { const data = await serviceRequest('/auth/accounts'); return { loggedIn: data.current.loggedIn, count: data.accounts.length }; });
  assert.ok(report.account.loggedIn, 'Scan and confirm a TV QR before this acceptance run');
  report.probe = await page.evaluate(() => new Promise(resolve => {
    const bridge = window.acceptanceBridge = new PalmServiceBridge();
    bridge.onservicecallback = text => resolve(JSON.parse(text));
    bridge.call('luna://com.jinmx.independent.playback.service/probe', '{}');
  }));
  assert.equal(report.probe.returnValue, true);
  const paths = ['/recommend', '/popular', '/search?keyword=Linksphotograph', '/region?rid=1', '/me/following', '/me/later', '/me/history', '/me/favorites', '/danmaku?bvid=BV1fwEwzeEPp', '/videoshot?bvid=BV1fwEwzeEPp', '/suggest?term=sheying'];
  report.api = await page.evaluate(async paths => Promise.all(paths.map(async path => {
    try { const data = await serviceRequest(path); return { path, result: 'PASS', items: data.items?.length, folders: data.folders?.length }; }
    catch (error) { return { path, result: 'FAIL', error: error.message }; }
  })), paths);
  const detail = await page.evaluate(() => serviceRequest('/detail?bvid=BV1864y1T7Ks'));
  report.multipart = { pages: detail.pages.length, partDuration: detail.pages[1].duration };
  report.up = await page.evaluate(async mid => { const data = await serviceRequest(`/up?mid=${mid}`); return { items: data.items.length, profile: Boolean(data.profile) }; }, detail.ownerMid);
  report.favorites = await page.evaluate(async () => {
    const data = await serviceRequest('/me/favorites');
    if (!data.folders.length) return { folders: 0 };
    const items = await serviceRequest(`/me/favorites/items?id=${data.folders[0].id}`);
    return { folders: data.folders.length, firstFolderItems: items.items.length };
  });
  await page.evaluate(async () => {
    if (profilePicker.open) profilePicker.close();
    if (loginDialog.open) loginDialog.close();
    if (!player.hidden) await leavePlayer();
    quality.value = 'auto'; selectedPart = 2; input.value = 'BV1864y1T7Ks'; await openVideo();
  });
  await page.waitForFunction(() => video.readyState >= 3 && !video.paused && video.currentTime > 0, null, { timeout: 60000 });
  const before = await page.evaluate(() => { showControls(); toggle.click(); return video.currentTime; });
  await page.waitForTimeout(2000);
  report.pause = await page.evaluate(() => ({ time: video.currentTime, paused: video.paused }));
  assert.equal(report.pause.paused, true); assert.ok(Math.abs(report.pause.time - before) < 0.2);
  await page.evaluate(() => { toggle.click(); document.querySelector('#forward').click(); });
  await page.waitForFunction(time => video.currentTime >= time + 9 && !video.seeking && !video.paused, before, { timeout: 30000 });
  report.forward = await page.evaluate(() => video.currentTime);
  await page.evaluate(() => document.querySelector('#backward').click());
  await page.waitForFunction(() => !video.seeking && video.readyState >= 3, null, { timeout: 30000 });
  report.backward = await page.evaluate(() => video.currentTime);
  await page.evaluate(() => leavePlayer());
  assert.equal(await page.evaluate(() => player.hidden), true);
  report.savedProgress = await page.evaluate(() => Number(localStorage.getItem(progressKey('BV1864y1T7Ks', 2))));
  await page.evaluate(() => openVideo());
  await page.waitForFunction(() => video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
  report.resumedAt = await page.evaluate(() => video.currentTime);
  assert.ok(Math.abs(report.savedProgress - report.resumedAt) < 3);
  report.subtitle = await page.evaluate(async () => {
    const data = await serviceRequest('/subtitles?bvid=BV1864y1T7Ks&page=2');
    if (!data.tracks.length) return { tracks: 0 };
    const body = await serviceRequest(`/subtitle?url=${encodeURIComponent(data.tracks[0].url)}`);
    return { tracks: data.tracks.length, cues: body.cues.length };
  });
  }
  await page.waitForFunction(() => video.readyState >= 3 && !video.paused && current.errors.length === 0, null, { timeout: 60000 });
  const start = Date.now();
  const startTime = await page.evaluate(() => video.currentTime);
  for (;;) {
    const sample = await page.evaluate(() => {
      const frames = video.getVideoPlaybackQuality(); const stats = dashPlayer.getStats();
      return { time: video.currentTime, paused: video.paused, ended: video.ended, ready: video.readyState, width: video.videoWidth, height: video.videoHeight, quality: current.quality, page: current.page, startupMs: current.startupMs, stalls: current.stalls, errors: current.errors, mediaError: video.error?.code || null, droppedFrames: frames.droppedVideoFrames, totalFrames: frames.totalVideoFrames, bufferingSeconds: stats.bufferingTime, stallsDetected: stats.stallsDetected, bandwidth: stats.estimatedBandwidth };
    });
    sample.elapsedSeconds = (Date.now() - start) / 1000;
    report.samples.push(sample);
    await writeFile(output, JSON.stringify(report, null, 2));
    if (report.samples.length % 6 === 1) console.log(JSON.stringify(sample));
    assert.equal(sample.mediaError, null); assert.equal(sample.errors.length, 0); assert.equal(sample.ended, false); assert.equal(sample.paused, false);
    if (sample.elapsedSeconds >= 1800 && sample.time - startTime >= 1800) break;
    await page.waitForTimeout(10000);
  }
  report.wallSeconds = (Date.now() - start) / 1000;
  report.advancedSeconds = report.samples.at(-1).time - startTime;
  const auxiliary = report.requests.filter(({ host }) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host));
  assert.equal(auxiliary.length, 0, 'Requests must not access a LAN helper');
  report.result = report.api.some(x => x.result === 'FAIL') ? 'PARTIAL' : 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: report.result, error: report.error, samples: report.samples.length })); await browser.close(); }
