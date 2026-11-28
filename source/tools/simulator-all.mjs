// Runs every Simulator suite one after another through tools/simulator-test.mjs.
// Before each suite it brings the Simulator to the front and checks that the app page answers CDP;
// a frozen page triggers one automatic Simulator restart (at most two per run), then BLOCKED with a clear message
// instead of every later suite timing out.
// Usage: PLAYWRIGHT_MODULE=… npm run test:simulator:all [-- --hdr] [-- --only=a,b]
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const SIMULATOR = '/Applications/webOS_TV_26_Simulator_1.5.0.app';
const suites = [
  'simulator-smoke', 'simulator-ui', 'simulator-refresh', 'simulator-region-top', 'simulator-popular', 'simulator-page-top',
  'simulator-hero-play', 'simulator-error', 'simulator-cancel', 'simulator-startup', 'simulator-player-back',
  'simulator-player-labels', 'simulator-resume', 'simulator-resume-cancel', 'simulator-account-progress',
  'simulator-danmaku-rate', 'simulator-auto', 'simulator-walkthrough', 'simulator-back-top', 'simulator-hero-keys', 'simulator-left-nav', 'simulator-library-cache',
  'simulator-background', // last: reopening from the App List changes the Simulator app lifecycle for later reloads
];
const direct = new Set(['simulator-background']);
if (process.argv.includes('--hdr')) suites.push('simulator-hdr'); // long and a known failure; opt-in only
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const selected = only ? suites.filter(name => only.includes(name) || only.includes(name.replace('simulator-', ''))) : suites;

async function appResponds() {
  let list;
  try { list = await (await fetch('http://127.0.0.1:9226/json/list', { signal: AbortSignal.timeout(3000) })).json(); }
  catch { return 'Simulator debugging port 9226 is not reachable'; }
  const target = list.find(t => /independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/.test(t.url));
  if (!target) return 'independent app page is not open in the Simulator';
  return new Promise(resolve => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve('app page does not answer CDP (frozen renderer); restart the Simulator'); }, 5000);
    ws.onerror = () => { clearTimeout(timer); resolve('CDP connection to the app page failed'); };
    // The target list can keep the app's address after a reload failed (e.g. the build folder was being
    // regenerated), while the page itself shows chrome-error://; ask the page where it really is.
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } }));
    ws.onmessage = message => {
      const data = JSON.parse(message.data);
      if (data.id !== 1) return;
      clearTimeout(timer); ws.close();
      const href = data.result?.result?.value || '';
      resolve(/app\/index\.html/.test(href) ? null : `app page shows ${href.slice(0, 40) || 'nothing'} (failed load); restart the Simulator`);
    };
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const running = () => { try { execFileSync('pgrep', ['-f', 'webOS_TV_26_Simulator_1.5.0']); return true; } catch { return false; } };
// The Simulator occasionally leaves the app renderer suspended after a page reload (0 % CPU, no CDP answer, no
// dialog); only a full restart recovers it. Stop every Simulator process (the frozen renderer outlives the main
// process) and relaunch the built-in-service build with CDP 9226.
async function restartSimulator() {
  try { execFileSync('pkill', ['-TERM', '-f', 'webOS_TV_26_Simulator_1.5.0']); } catch {}
  for (let i = 0; i < 20 && running(); i++) await sleep(1000);
  if (running()) { try { execFileSync('pkill', ['-KILL', '-f', 'webOS_TV_26_Simulator_1.5.0']); } catch {} await sleep(2000); }
  spawn(`${SIMULATOR}/Contents/MacOS/webOS_TV_26_Simulator_1.5.0`,
    [`${process.cwd()}/output/simulator-build/app`, '{}', '--remote-debugging-port=9226', '--remote-debugging-address=127.0.0.1'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) { await sleep(1000); if (!(await appResponds())) break; }
  await sleep(8000); // let the app and its service finish starting
}

const results = [];
let restarts = 0;
for (const name of selected) {
  try { execFileSync('open', ['-a', SIMULATOR]); } catch {}
  await sleep(1000);
  let problem = await appResponds();
  if (problem && restarts < 2) {
    restarts++;
    console.log(`RESTART before ${name}: ${problem}`);
    await restartSimulator();
    try { execFileSync('open', ['-a', SIMULATOR]); } catch {}
    await sleep(1000);
    problem = await appResponds();
  }
  if (problem) { results.push({ suite: name, result: 'BLOCKED', error: problem }); console.log(`BLOCKED ${name}: ${problem}`); break; }
  const started = Date.now();
  // Suites that need real page visibility run without the runner's focus emulation and restore their own state.
  const args = direct.has(name) ? [`tests/${name}.mjs`] : ['tools/simulator-test.mjs', `${name}.mjs`];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout: 15 * 60 * 1000 });
  const output = `${run.stdout}\n${run.stderr}`;
  const verdict = run.status === 0 ? 'PASS' : 'FAIL';
  const error = verdict === 'FAIL' ? (output.match(/"error":"([^"]{0,200})/)?.[1] || output.trim().split('\n').find(line => /Error/.test(line))?.slice(0, 200) || `exit ${run.status}`) : undefined;
  results.push({ suite: name, result: verdict, seconds: Math.round((Date.now() - started) / 1000), ...(error && { error }) });
  console.log(`${verdict} ${name} ${Math.round((Date.now() - started) / 1000)}s${error ? ` — ${error}` : ''}`);
}
const summary = { date: new Date().toISOString(), pass: results.filter(r => r.result === "PASS").length, total: selected.length, simulatorRestarts: restarts, results };
await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/simulator-all.json', JSON.stringify(summary, null, 2));
console.log(`${summary.pass}/${summary.total} PASS`);
process.exitCode = summary.pass === summary.total ? 0 : 1;
