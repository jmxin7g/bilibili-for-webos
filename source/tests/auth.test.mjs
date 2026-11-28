import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';

test('switch validates a candidate before replacing active credentials; logout removes only that account', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'independent-accounts-'));
  process.env.SERVICE_DATA_DIR = dir;
  const auth = await import(`../auth.mjs?test=${Date.now()}`);
  delete process.env.SERVICE_DATA_DIR;
  const jar = mid => `# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tfixture-${mid}\n`;
  await mkdir(join(dir, 'accounts'), { recursive: true });
  for (const mid of [111, 222]) {
    await writeFile(join(dir, 'accounts', `${mid}.cookies`), jar(mid));
    await writeFile(join(dir, 'accounts', `${mid}.json`), JSON.stringify({ mid, name: `fixture-${mid}`, vip: '', face: '' }));
  }
  await writeFile(auth.cookieFile, jar(111));
  let valid = false;
  let networkFailure = false;
  t.mock.method(https, 'request', (options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      if (networkFailure) { request.emit('error', Object.assign(new Error('fixture network failure'), { code: 'ECONNRESET' })); return; }
      const mid = Number(options.headers.Cookie.match(/fixture-(\d+)/)[1]);
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
      callback(response);
      const body = mid === 222 && !valid ? { code: -101 } : { code: 0, data: { isLogin: true, mid, uname: `fixture-${mid}`, face: '', vipStatus: 0 } };
      response.emit('data', Buffer.from(JSON.stringify(body))); response.emit('end');
    };
    return request;
  });
  try {
    await assert.rejects(auth.switchAccount('222'), /登录已失效/);
    assert.equal(await readFile(auth.cookieFile, 'utf8'), jar(111));
    valid = true;
    assert.equal((await auth.switchAccount('222')).mid, 222);
    assert.equal(await readFile(auth.cookieFile, 'utf8'), jar(222));
    assert.equal((await auth.accounts()).accounts.filter(x => x.active)[0].mid, 222);
    networkFailure = true;
    await assert.rejects(auth.logout(), /ECONNRESET/);
    assert.equal(await readFile(auth.cookieFile, 'utf8'), jar(222));
    networkFailure = false;
    assert.deepEqual(await auth.logout(), { loggedIn: false });
    await assert.rejects(access(auth.cookieFile), { code: 'ENOENT' });
    assert.deepEqual((await readdir(join(dir, 'accounts'))).sort(), ['111.cookies', '111.json']);
    assert.equal((await auth.accounts()).accounts.length, 1);
  } finally { delete process.env.SERVICE_DATA_DIR; t.mock.restoreAll(); await rm(dir, { recursive: true, force: true }); }
});

test('out-of-order QR generation leaves only the refreshed QR eligible for polling', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'independent-login-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.SERVICE_DATA_DIR = dir;
  const auth = await import('../auth.mjs?qr-refresh-test');
  delete process.env.SERVICE_DATA_DIR;
  const generate = [];
  const polled = [];
  t.mock.method(https, 'request', (options, callback) => {
    const request = new EventEmitter();
    function reply(data) {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ code: 0, data })));
      response.emit('end');
    }
    request.end = () => {
      const url = new URL(options.path, 'https://passport.bilibili.com');
      if (url.pathname.endsWith('/generate')) generate.push(reply);
      else {
        polled.push(url.searchParams.get('qrcode_key'));
        reply({ code: 86101 });
      }
    };
    return request;
  });
  const first = auth.createLogin();
  const newest = auth.createLogin();
  generate[1]({ url: 'https://passport.bilibili.com/fixture/new', qrcode_key: 'new' });
  const qr = await newest;
  const expected = QRCode.create('https://passport.bilibili.com/fixture/new').modules;
  assert.equal(qr.size, expected.size);
  assert.equal(qr.matrix, Array.from(expected.data).join(''));
  generate[0]({ url: 'https://passport.bilibili.com/fixture/old', qrcode_key: 'old' });
  await assert.rejects(first, /二维码请求已取消/);
  assert.deepEqual(await auth.pollLogin(qr.id), { status: 'waiting' });
  assert.deepEqual(polled, ['new']);
  const pending = auth.createLogin();
  auth.cancelLogin();
  generate[2]({ url: 'https://passport.bilibili.com/fixture/closed', qrcode_key: 'closed' });
  await assert.rejects(pending, /二维码请求已取消/);
  assert.deepEqual(await auth.pollLogin(qr.id), { status: 'cancelled' });
});
