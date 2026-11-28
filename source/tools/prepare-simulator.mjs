import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// The same application/service payload is staged for the official Simulator; accounts remain separate.
execFileSync(process.execPath, [fileURLToPath(new URL('package-tv.mjs', import.meta.url))], { stdio: 'inherit' });
const source = new URL(process.env.TV_NETWORK_CA ? '../output/tv-build-network/' : '../output/tv-build/', import.meta.url);
const build = new URL('../output/simulator-build/', import.meta.url);
execFileSync('rm', ['-rf', fileURLToPath(build)]);
await mkdir(build, { recursive: true });
for (const name of ['app', 'service']) execFileSync('cp', ['-R', fileURLToPath(new URL(name, source)), fileURLToPath(new URL(name, build))]);
const metadata = new URL('service/package.json', build);
const data = JSON.parse(await readFile(metadata, 'utf8'));
data.main = 'simulator-service.cjs';
await writeFile(metadata, `${JSON.stringify(data, null, 2)}\n`);
const directory = fileURLToPath(new URL('../.local/simulator-service/', import.meta.url));
await writeFile(new URL('service/simulator-service.cjs', build), `process.env.SERVICE_DATA_DIR = ${JSON.stringify(directory)};
process.env.SERVICE_PORT = '8770';

// A listening HTTP server keeps the forked service alive after Simulator drops IPC.
process.once('disconnect', () => process.exit(0));

// Simulator 1.5.0 reports the destination service ID as sender. This is a test-only shim, not a caller authorization test.
process.prependListener('message', data => {
  if ((data.cmd === 'called-probe' || data.cmd === 'called-session') && data.msg.sender === 'com.jinmx.independent.playback.service') data.msg.sender = 'com.jinmx.independent.playback';
});
require('./service.cjs');
`);
console.log(`Simulator app: ${fileURLToPath(new URL('app/', build))}\nSimulator service: ${fileURLToPath(new URL('service/', build))}`);
