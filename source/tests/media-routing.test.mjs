import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { proxyMediaRange } from '../media-proxy.mjs';
import { createMediaRoute, monitorMediaRoute } from '../media-routing.mjs';

for (const { burst, cooldown } of [{ burst: false }, { burst: true }, { burst: true, cooldown: true }, { burst: false, cooldown: true }]) test(`a ${burst ? 'stalled-after-fast-start' : 'slow'} video fragment resumes on the measured winner${cooldown ? ' during cooldown' : ''}`, async () => {
  const primary = 'upos-sz-mirrorcosov.bilivideo.com';
  const backup = 'upos-hz-mirrorakam.akamaized.net';
  const path = '/upgcxcode/1/1/123/123-1-30102.m4s';
  const entry = { id: 112, bandwidth: 2500000, baseUrl: `https://${primary}${path}?upsig=original`, backupUrl: [`https://${backup}${path}?hdnts=issued`] };
  const stream = { url: entry.baseUrl, backups: entry.backupUrl, route: createMediaRoute(entry) };
  if (cooldown) stream.route.nextRaceAt = performance.now() + 15000;
  const calls = [];
  const size = burst ? 1048576 : 200000;
  const networkFetch = async (address, { headers, signal }) => {
    const url = new URL(address);
    calls.push({ host: url.host, range: headers.Range, query: url.search });
    const [start, end] = headers.Range.match(/\d+/g).map(Number);
    const length = end - start + 1;
    const body = url.host === primary ? new ReadableStream({
      start(controller) {
        let sent = 0;
        const chunk = () => { const data = Uint8Array.from({ length: burst ? 128000 : 1000 }, (_, i) => (start + sent + i) % 251); sent += data.length; return data; };
        controller.enqueue(chunk());
        const timer = setInterval(() => { if (!burst) controller.enqueue(chunk()); }, 200);
        signal.addEventListener('abort', () => { clearInterval(timer); controller.error(signal.reason); }, { once: true });
      },
    }) : Uint8Array.from({ length }, (_, i) => (start + i) % 251);
    return new Response(body, { status: 206, headers: { 'Content-Length': String(length), 'Content-Range': `bytes ${start}-${end}/${size}` } });
  };
  const server = createServer((request, response) => {
    const deadline = setTimeout(() => response.destroy(new Error('test deadline: primary is still slow')), 3000);
    response.once('close', () => clearTimeout(deadline));
    proxyMediaRange(request, response, stream, {}, networkFetch).catch(error => response.destroy(error));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}/media`;
    const retry = await fetch(address, { headers: { Range: `bytes=0-${size - 1}`, 'X-Playback-Buffer': burst ? '30' : cooldown ? '2.5' : '0' } });
    assert.deepEqual(new Uint8Array(await retry.arrayBuffer()), Uint8Array.from({ length: size }, (_, i) => i % 251), 'the same response resumes with no missing or repeated bytes');
    assert.equal(retry.headers.get('content-range'), `bytes 0-${size - 1}/${size}`);
    assert.equal(stream.route.active, backup);
    assert.equal(calls.at(-1).host, backup);
    assert.equal(calls.at(-1).query, '?hdnts=issued', 'Akamai keeps the Bilibili-issued signature');
    assert.equal(stream.route.switches, 1);
    if (cooldown && !burst) assert.equal(stream.route.events[0].trigger, 'buffer-deadline');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

for (const wrongRange of [false, true]) test(`a truncated fragment ${wrongRange ? 'rejects a mismatched backup range' : 'resumes without repeating or dropping bytes'}`, async () => {
  const primary = 'upos-sz-mirrorcosov.bilivideo.com';
  const backup = 'upos-hz-mirrorakam.akamaized.net';
  const path = '/upgcxcode/123-1-30102.m4s';
  const entry = { id: 112, bandwidth: 2500000, baseUrl: `https://${primary}${path}`, backupUrl: [`https://${backup}${path}`] };
  const stream = { url: entry.baseUrl, backups: entry.backupUrl, route: createMediaRoute(entry) };
  const size = 200000;
  const calls = [];
  const networkFetch = async (address, { headers }) => {
    const [start, end] = headers.Range.match(/\d+/g).map(Number);
    const host = new URL(address).host;
    calls.push({ host, start, end });
    const body = host === primary ? new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from({ length: 100000 }, (_, i) => i % 251));
        setTimeout(() => controller.error(new Error('truncated upstream body')), 50);
      },
    }) : Uint8Array.from({ length: end - start + 1 }, (_, i) => (start + i) % 251);
    return new Response(body, { status: 206, headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${wrongRange && start > 0 ? 0 : start}-${end}/${size}` } });
  };
  const server = createServer((request, response) => proxyMediaRange(request, response, stream, {}, networkFetch).catch(error => response.destroy(error)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { headers: { Range: 'bytes=0-199999' } });
    if (wrongRange) await assert.rejects(response.arrayBuffer());
    else assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from({ length: size }, (_, i) => i % 251));
    assert.ok(calls.some(call => call.host === backup && call.start === 100000), 'backup starts exactly after bytes already delivered');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a healthy media fragment stays on its assigned host without probe traffic', async () => {
  const url = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/123-1-30102.m4s?upsig=original';
  const stream = { url, backups: [], route: createMediaRoute({ id: 112, bandwidth: 2500000, baseUrl: url, backupUrl: [] }) };
  const calls = [];
  const networkFetch = async address => {
    calls.push(address);
    return new Response(new Uint8Array(200000), { status: 206, headers: { 'Content-Length': '200000', 'Content-Range': 'bytes 0-199999/200000' } });
  };
  const server = createServer((request, response) => proxyMediaRange(request, response, stream, {}, networkFetch).catch(error => response.destroy(error)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { headers: { Range: 'bytes=0-199999' } });
    assert.equal((await response.arrayBuffer()).byteLength, 200000);
    assert.deepEqual(calls, [url]);
    assert.equal(stream.route.active, null);
    assert.equal(stream.route.switches, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a slow but still progressing fragment with sufficient buffer preserves ordinary cooldown', async () => {
  const url = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/123-1-30102.m4s';
  const route = createMediaRoute({ id: 112, bandwidth: 2500000, baseUrl: url, backupUrl: [] });
  route.nextRaceAt = performance.now() + 15000;
  const routed = new AbortController(), client = new AbortController();
  let calls = 0;
  const monitor = monitorMediaRoute(route, url, { headers: { range: 'bytes=0-199999', 'x-playback-buffer': '30' } }, {}, async () => { calls++; throw new Error('unexpected probe during ordinary cooldown'); }, routed, client.signal);
  monitor.chunk(1000);
  const timer = setInterval(() => monitor.chunk(1000), 200);
  try {
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(calls, 0);
    assert.equal(routed.signal.aborted, false);
  } finally { clearInterval(timer); monitor.stop(); client.abort(); }
});

test('a low-buffer fragment runs only one deadline race when the backup fails', async () => {
  const primary = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/123-1-30102.m4s';
  const backup = 'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/123-1-30102.m4s';
  const route = createMediaRoute({ id: 125, bandwidth: 20000000, baseUrl: primary, backupUrl: [backup] });
  route.pool = [];
  route.nextRaceAt = performance.now() + 15000;
  const routed = new AbortController(), client = new AbortController();
  let calls = 0;
  const monitor = monitorMediaRoute(route, primary, { headers: { range: 'bytes=0-9999999', 'x-playback-buffer': '2.5' } }, {}, async () => { calls++; throw new Error('backup unavailable'); }, routed, client.signal);
  monitor.chunk(1000);
  const timer = setInterval(() => monitor.chunk(1000), 200);
  try {
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(calls, 1, 'failed urgent probe must not repeat every timer tick');
    assert.equal(routed.signal.aborted, false, 'keep receiving the original source when no backup wins');
  } finally { clearInterval(timer); monitor.stop(); client.abort(); }
});
