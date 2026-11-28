import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createPlaybackMappings } from '../playback-mappings.mjs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = server.indexOf("      const requestedQuality = url.searchParams.get('quality');");
const end = server.indexOf('      media = await api(', start);
const resolveCode = `(async () => { ${server.slice(start, end)} })()`;

const sourceChecks = server.slice(server.indexOf('function supportedMediaUrl('), server.indexOf('function registerStream('));

async function resolveQuality(quality, ids, fallback = false, video = ids.map(id => ({
  id, codecs: 'avc1.test', baseUrl: 'https://cdn.bilivideo.com/video',
}))) {
  let status = 200, result;
  const context = vm.createContext({
    url: new URL(`http://localhost/resolve?quality=${quality}${fallback ? "&fallback=1" : ""}`), bvid: 'BV1XypX6aEfV', part: { cid: 1 },
    info: { title: 'Test', owner: { name: 'Test' }, duration: 10 }, cover: '', partInfo: {},
    api: async () => ({ support_formats: [126, 125, 120, 116, 100, 80, 64, 6].map(quality => ({ quality, new_description: String(quality) })),
      dash: { duration: 10, video, audio: [{ codecs: 'mp4a.test', base_url: '//cdn.bilivideo.cn/audio' }] } }),
    response: { writeHead(code) { status = code; return this; }, setHeader() {}, end(body) { result = JSON.parse(body); } },
    request: { headers: { host: 'localhost' } }, URL, randomUUID: () => 'test', representation: stream => `<Representation id="${stream.id}"/>`, manifests: createPlaybackMappings(),
  });
  await vm.runInContext(sourceChecks + '\n' + resolveCode, context);
  return { status, result, manifest: context.manifests.get('test') };
}

test('removed highest mode is rejected', async () => {
  const { status, result } = await resolveQuality('max', [120, 80]);
  assert.equal(status, 400); assert.equal(result.error, '画质参数无效');
});
test('removed intelligent repair quality is unavailable', async () => {
  const { status, result } = await resolveQuality('qn:100', [120, 100, 80]);
  assert.equal(status, 400); assert.equal(result.error, '该视频不提供所选画质');
});
test('removed 240P quality is unavailable', async () => {
  const { status, result } = await resolveQuality('qn:6', [120, 80, 6]);
  assert.equal(status, 400); assert.equal(result.error, '该视频不提供所选画质');
});
test('auto excludes removed qualities from its menu and playback tracks', async () => {
  const { status, result, manifest } = await resolveQuality('auto', [120, 100, 80, 6]);
  assert.equal(status, 200);
  assert.ok(!result.qualityOptions.some(option => [6, 100].includes(option.id)));
  assert.ok(!manifest.includes('id="100"'));
  assert.ok(!manifest.includes('id="6"'));
  assert.ok(manifest.includes('id="120"'));
  assert.ok(manifest.includes('id="80"'));
});
test('an explicit unavailable quality still reports its error', async () => {
  const { status, result } = await resolveQuality('qn:127', [120, 80]);
  assert.equal(status, 400); assert.equal(result.error, '该视频不提供所选画质');
});

test('default Dolby Vision falls to HDR before 4K when Dolby Vision has no stream', async () => {
  const { result, manifest } = await resolveQuality('qn:126', [125, 120, 80], true);
  assert.equal(result.quality, 125);
  assert.ok(manifest.includes('id="125"'));
  assert.ok(!manifest.includes('id="120"'));
});
test('default Dolby Vision falls to 4K when HDR is absent too', async () => {
  const { result } = await resolveQuality('qn:126', [120, 80], true);
  assert.equal(result.quality, 120);
});
test('default quality skips unavailable levels without exceeding the preference', async () => {
  const { result } = await resolveQuality('qn:116', [120, 80, 64], true);
  assert.equal(result.quality, 80);
});
test('available default quality is retained', async () => {
  const { result } = await resolveQuality('qn:126', [126, 125, 120], true);
  assert.equal(result.quality, 126);
});

const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const selectionStart = app.indexOf('    let requestedQuality = playbackQuality || quality.value;');
const selectionEnd = app.indexOf('    current = { bvid: media.bvid', selectionStart);
const selectionCode = `(async () => { ${app.slice(selectionStart, selectionEnd)} return { media, requestedQuality }; })()`;
test('default fallback skips unsupported codecs, preserves preference, and marks actual quality', async () => {
  const paths = [];
  const preference = { value: 'qn:126' };
  const options = [
    { id: 126, value: 'qn:126', codecs: ['hvc1.unsupported'] },
    { id: 125, value: 'qn:125', codecs: ['hvc1.unsupported'] },
    { id: 120, value: 'qn:120', codecs: ['avc1.4k'] },
    { id: 80, value: '1080', codecs: ['avc1.1080'] },
  ];
  const context = vm.createContext({
    playbackQuality: null, quality: preference, playbackCodec: null, input: { value: 'BV1XypX6aEfV' }, selectedPart: 2,
    generation: 1, playbackGeneration: 1, controller: new AbortController(),
    MediaSource: { isTypeSupported: value => value.includes('avc1') },
    serviceRequest: async path => {
      paths.push(new URL(path, 'http://localhost'));
      return { format: 'dash', quality: paths.length === 1 ? 126 : 120, videoCodec: paths.length === 1 ? 'hvc1.unsupported' : 'avc1.4k', qualityOptions: options };
    },
  });
  const result = await vm.runInContext(selectionCode, context);
  assert.equal(paths[0].searchParams.get('fallback'), '1');
  assert.equal(paths[1].searchParams.get('quality'), 'qn:120');
  assert.equal(paths[1].searchParams.get('codec'), 'avc1.4k');
  assert.equal(paths[1].searchParams.get('page'), '2');
  assert.equal(result.requestedQuality, 'qn:120');
  assert.equal(preference.value, 'qn:126');
});
test('manual playback selection remains exact without default fallback', async () => {
  const paths = [];
  const context = vm.createContext({
    playbackQuality: 'qn:126', quality: { value: 'qn:120' }, playbackCodec: null, input: { value: 'BV1XypX6aEfV' }, selectedPart: 1,
    generation: 1, playbackGeneration: 1, controller: new AbortController(),
    MediaSource: { isTypeSupported: () => false },
    serviceRequest: async path => { paths.push(path); return { format: 'dash', quality: 126, videoCodec: 'hvc1.unsupported' }; },
  });
  await assert.rejects(vm.runInContext(selectionCode, context), /当前设备不支持所选画质的编码/);
  assert.equal(paths.length, 1);
  assert.ok(!paths[0].includes('fallback='));
});

test('auto exposes multiple qualities including 4K for native bandwidth adaptation', async () => {
  const { status, manifest } = await resolveQuality('auto', [120, 80, 64]);
  assert.equal(status, 200);
  for (const id of [120, 80, 64]) assert.ok(manifest.includes(`id="${id}"`));
});
test('auto can start with only a lower quality available', async () => {
  const { status, result } = await resolveQuality('auto', [64]);
  assert.equal(status, 200); assert.equal(result.quality, 64);
});
test('fixed mode exposes one video quality and cannot adapt down', async () => {
  for (const value of ['qn:120']) {
    const { manifest } = await resolveQuality(value, [120, 80, 64]);
    assert.ok(manifest.includes('id="120"'));
    assert.ok(!manifest.includes('id="80"')); assert.ok(!manifest.includes('id="64"'));
  }
});

const updateStart = app.indexOf('function updatePlaybackQuality()');
const updateCode = app.slice(updateStart, app.indexOf('function playerOptionsFor(', updateStart));
test('automatic changes update the displayed quality and session without changing its mode', () => {
  const source = {};
  const context = vm.createContext({
    current: { requestedQuality: 'auto', owner: 'Test', quality: 80, qualityOptions: [{ id: 120, label: '4K 超高清' }] },
    dashPlayer: { getVariantTracks: () => [{ active: true, originalVideoId: '120-avc1.test' }] },
    qualitySwitch: {}, document: { querySelector: () => source },
  });
  vm.runInContext(updateCode + '\nupdatePlaybackQuality();', context);
  assert.equal(context.current.quality, 120);
  assert.equal(context.current.requestedQuality, 'auto');
  assert.equal(context.qualitySwitch.textContent, '自动 · 4K 超高清');
  assert.equal(source.textContent, undefined, 'player source line shows only the owner, not the actual quality');
});
test('automatic quality events leave fixed mode unchanged', () => {
  for (const mode of ['qn:120']) {
    const context = vm.createContext({ current: { requestedQuality: mode, quality: 120 }, dashPlayer: {} });
    vm.runInContext(updateCode + '\nupdatePlaybackQuality();', context);
    assert.equal(context.current.quality, 120);
  }
});

test('auto omits rejected tracks and uses an HTTPS Bilibili backup for the remaining track', async () => {
  const { result, manifest } = await resolveQuality('auto', [], false, [
    { id: 120, codecs: 'avc1.test', baseUrl: 'https://cdn.bilivideo.cn.invalid/high' },
    { id: 80, codecs: 'avc1.test', base_url: 'http://cdn.bilivideo.cn/main', backup_url: [
      'invalid URL', 'https://cdn.bilivideo.cn:9443/private', '//cdn.bilivideo.cn/backup?signature=example',
    ] },
  ]);
  assert.equal(result.quality, 80);
  assert.equal(result.sourceHost, 'cdn.bilivideo.cn');
  assert.match(manifest, /id="80"/);
  assert.doesNotMatch(manifest, /id="120"/);
});
