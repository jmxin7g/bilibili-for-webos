import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { httpsResponse } from '../https-response.mjs';

test('HTTPS rejects an untrusted certificate and streams verified Range bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'independent-tls-'));
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    assert.equal(request.headers.range, 'bytes=2-5');
    response.writeHead(206, { 'Content-Range': 'bytes 2-5/8', 'Content-Length': '4', 'Accept-Ranges': 'bytes' });
    response.end('2345');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `https://localhost:${server.address().port}/video`;
  try {
    await assert.rejects(httpsResponse(address, { headers: { Range: 'bytes=2-5' }, signal: AbortSignal.timeout(3000) }), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    process.env.BILI_EXTRA_CA_FILE = cert;
    const trusted = await import(`../https-response.mjs?test=${Date.now()}`);
    delete process.env.BILI_EXTRA_CA_FILE;
    const response = await trusted.httpsResponse(address, { headers: { Range: 'bytes=2-5' }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/8');
    assert.equal(await response.text(), '2345');
    await assert.rejects(trusted.httpsResponse(address.replace('localhost', '127.0.0.1'), { headers: {}, signal: AbortSignal.timeout(3000) }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  } finally {
    delete process.env.BILI_EXTRA_CA_FILE;
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
