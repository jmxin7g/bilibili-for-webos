import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { biliRequest, biliText } from '../bilibili.mjs';

test('danmaku decodes actual raw DEFLATE and standard zlib-wrapped DEFLATE', async t => {
  const xml = '<i><d p="1,1,25,16777215">真实弹幕</d></i>';
  for (const compress of [deflateRawSync, deflateSync]) {
    t.mock.method(https, 'request', (options, callback) => {
      const request = new EventEmitter();
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200; response.headers = { 'content-encoding': 'deflate' };
        callback(response);
        response.emit('data', compress(Buffer.from(xml))); response.emit('end');
      };
      return request;
    });
    assert.equal(await biliText('api.bilibili.com', '/x/v1/dm/list.so?oid=1'), xml);
    t.mock.restoreAll();
  }
});

test('native cookie jar saves login cookies and scopes credentials to the API host', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'independent-cookie-'));
  const file = join(dir, 'candidate.cookies');
  let captured;
  t.mock.method(https, 'request', (options, callback) => {
    captured = options;
    const request = new EventEmitter();
    request.end = () => {
      const response = new EventEmitter(); response.statusCode = 200;
      response.headers = { 'set-cookie': ['SESSDATA=fixture; Domain=.bilibili.com; Path=/; Secure; HttpOnly; Max-Age=60', 'bili_jct=fixture-csrf; Domain=.bilibili.com; Path=/; Secure'] };
      callback(response); response.emit('data', Buffer.from('{"code":0}')); response.emit('end');
    };
    return request;
  });
  try {
    await biliRequest('passport.bilibili.com', '/qr', { saveCookies: file });
    const jar = await readFile(file, 'utf8');
    assert.match(jar, /\.bilibili.com\tTRUE\t\/\tTRUE\t\d+\tSESSDATA\tfixture/);
    await writeFile(file, jar + 'outside.example\tFALSE\t/\tTRUE\t0\tforeign\tprivate\n.bilibili.com\tTRUE\t/\tTRUE\t1\texpired\tprivate\n');
    await biliRequest('api.bilibili.com', '/nav', { cookieFile: file, cookie: 'buvid3=device' });
    assert.equal(captured.headers.Cookie, 'SESSDATA=fixture; bili_jct=fixture-csrf; buvid3=device');
    assert.equal(captured.rejectUnauthorized, undefined);
    await assert.rejects(biliRequest('outside.example', '/nav', { cookieFile: file }), /主机不受支持/);
  } finally { t.mock.restoreAll(); await rm(dir, { recursive:true, force:true }); }
});
