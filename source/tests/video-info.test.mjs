import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoInfoReader } from '../video-info.mjs';

test('a resolve followed by three playback metadata requests shares one view query', async () => {
  let calls = 0;
  let time = 0;
  const read = createVideoInfoReader(async () => 'session A', async bvid => ({ bvid, call: ++calls }), () => time);
  const first = await read('video');
  assert.deepEqual(await Promise.all([read('video'), read('video'), read('video')]), [first, first, first]);
  assert.equal(calls, 1);
  time += 5000;
  const [fresh, shared] = await Promise.all([read('video'), read('video')]);
  assert.equal(fresh, shared);
  assert.equal(calls, 2);
});

test('pending requests and cached responses are isolated by credentials', async () => {
  let credentials = 'session A';
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const read = createVideoInfoReader(async () => credentials, async (bvid, snapshot) => {
    if (snapshot === 'session A') await promise;
    return { bvid, snapshot };
  });
  const beforeSwitch = read('video');
  credentials = 'session B';
  assert.deepEqual(await read('video'), { bvid: 'video', snapshot: 'session B' });
  resolve();
  assert.deepEqual(await beforeSwitch, { bvid: 'video', snapshot: 'session A' });
  assert.deepEqual(await read('video'), { bvid: 'video', snapshot: 'session B' });
});

test('an upstream failure permits a fresh request', async () => {
  let calls = 0;
  const read = createVideoInfoReader(async () => '', async () => {
    if (++calls === 1) throw new Error('upstream error');
    return { title: 'video' };
  });
  await assert.rejects(read('video'), /upstream error/);
  assert.deepEqual(await read('video'), { title: 'video' });
});
