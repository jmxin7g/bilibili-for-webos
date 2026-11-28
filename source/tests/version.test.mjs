import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('app, service, about page and package versions match', async () => {
  const app = JSON.parse(await read('app/appinfo.json')).version;
  const service = JSON.parse(await read('service/package.json')).version;
  const pkg = JSON.parse(await read('package.json')).version;
  const lock = JSON.parse(await read('package-lock.json'));
  const about = (await read('app/index.html')).match(/id="about-version">([^<]+)</)?.[1];
  assert.match(app, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    { service, pkg, lock: lock.version, lockRoot: lock.packages[''].version, about },
    { service: app, pkg: app, lock: app, lockRoot: app, about: app },
  );
});
