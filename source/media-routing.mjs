import routing from './vendor/bilibili-accelerator/routing.cjs';
import core from './vendor/bilibili-accelerator/rewrite.cjs';

export function createMediaRoute(entry) {
  const table = routing.buildTable({ dash: { video: [entry] } });
  const rep = table.reps[routing.fileKey(entry.baseUrl || entry.base_url)];
  return { rep, pool: core.CANDIDATE_POOL, active: null, switches: 0, nextRaceAt: 0, cooldownMs: 0, failed: {}, measured: {}, lost: {}, estimators: new Map(), events: [], racing: null };
}

export function routedUrl(route) {
  return route.active ? routing.urlFor(route.rep, route.active) : null;
}

function hostStats(route, host) {
  if (!route.estimators.has(host)) route.estimators.set(host, { est: routing.createEstimator(), errors: [] });
  return route.estimators.get(host);
}

async function race(route, host, range, rate, trigger, headers, networkFetch, signal) {
  if (route.racing) return route.racing;
  const urgent = ['no-data-gap', 'buffer-deadline'].includes(trigger);
  if ((!urgent && trigger !== 'incomplete-fragment' && performance.now() < route.nextRaceAt) || route.switches >= routing.MAX_SWITCHES) return null;
  const challengers = routing.pickChallengers({
    candidates: routing.candidatesFor(route.rep, route.pool), current: host,
    issued: route.rep.issued, measured: route.measured, failed: route.failed, lost: route.lost, now: Date.now(),
  });
  if (!challengers.length) return null;
  const end = Math.min(range.end, range.start + routing.RACE_BYTES - 1);
  const expected = end - range.start + 1;
  const controllers = challengers.map(() => new AbortController());
  const results = [];
  route.racing = (async () => {
    let winner;
    try {
      winner = await Promise.any(challengers.map(async (candidate, index) => {
        const started = performance.now();
        try {
          const upstream = await networkFetch(routing.urlFor(route.rep, candidate), {
            headers: { ...headers, Range: `bytes=${range.start}-${end}` }, redirect: 'error',
            signal: AbortSignal.any([signal, controllers[index].signal, AbortSignal.timeout(urgent ? 2000 : routing.RACE_TIMEOUT_MS)]),
          });
          if (upstream.status !== 206 || !upstream.headers.get('content-range')?.startsWith(`bytes ${range.start}-${end}/`)) {
            await upstream.body.cancel();
            throw new Error(`race HTTP/range mismatch (${upstream.status})`);
          }
          let bytes = 0;
          for await (const chunk of upstream.body) bytes += chunk.byteLength;
          if (bytes !== expected) throw new Error(`race incomplete (${bytes}/${expected})`);
          const result = { host: candidate, ok: true, bytes, ms: performance.now() - started };
          results.push(result);
          route.measured[candidate] = true;
          hostStats(route, candidate).est.sample(result.ms, bytes);
          return result;
        } catch (error) {
          results.push({ host: candidate, ok: false, error: error.message });
          if (!signal.aborted && !controllers[index].signal.aborted) route.failed[candidate] = (route.failed[candidate] || 0) + 1;
          throw error;
        }
      }));
    } catch (error) {
      if (!(error instanceof AggregateError)) throw error;
      if (!signal.aborted) console.warn(`media race: ${host}; ${results.map(r => `${r.host}: ${r.error}`).join('; ')}`);
      route.cooldownMs = routing.nextCooldown('no-switch', route.switches, route.cooldownMs);
      route.nextRaceAt = performance.now() + route.cooldownMs;
      return null;
    } finally {
      controllers.forEach(controller => controller.abort());
    }
    if (signal.aborted) return null;
    const stats = hostStats(route, host);
    const recentErrors = stats.errors.filter(time => performance.now() - time < routing.ERROR_WINDOW_MS).length;
    const verdict = routing.stuckRaceVerdict([winner], rate, stats.est.estimate() || 0, recentErrors, expected);
    challengers.filter(candidate => candidate !== winner.host).forEach(candidate => { route.lost[candidate] = Date.now(); });
    route.events.push({ trigger, from: host, winner: winner.host, ms: Math.round(winner.ms), bytes: expected, switchTo: verdict.switchTo, retryOn: verdict.retryOn });
    if (verdict.switchTo) {
      route.active = verdict.switchTo;
      route.switches++;
      route.nextRaceAt = performance.now() + routing.nextCooldown('switch', route.switches);
    } else {
      route.cooldownMs = routing.nextCooldown('no-switch', route.switches, route.cooldownMs);
      route.nextRaceAt = performance.now() + route.cooldownMs;
    }
    const retry = verdict.switchTo || verdict.retryOn;
    if (retry) console.log(`media race: ${host} -> ${retry}; ${expected} bytes in ${Math.round(winner.ms)}ms (${trigger})`);
    return retry ? routing.urlFor(route.rep, retry) : null;
  })();
  try { return await route.racing; }
  finally { route.racing = null; }
}

// Transport adapter for the upstream pure routing decisions. Only video body
// ranges are monitored; init/index bytes are too small to establish goodput.
export function monitorMediaRoute(route, address, request, headers, networkFetch, routedController, clientSignal) {
  const range = routing.parseRange(request.headers.range);
  const host = new URL(address).host;
  const stats = hostStats(route, host);
  const startedAt = performance.now();
  const buffer = Number(request.headers['x-playback-buffer'] || 0);
  if (!Number.isFinite(buffer) || buffer < 0) throw new Error('Invalid playback buffer');
  let loaded = 0;
  let firstByteAt = null;
  let lastByteAt = null;
  let deadlineRaced = false;
  const samples = [[startedAt, 0]];
  const useful = range && Number.isFinite(range.length) && range.length >= 128 * 1024;
  const timer = useful ? setInterval(() => {
    const now = performance.now();
    samples.push([now, loaded]);
    const rate = routing.recentRate(samples, now, 1000);
    const bufferAhead = Math.max(0, buffer - (now - startedAt) / 1000);
    const verdict = routing.evaluate({
      now, requiredBps: route.rep.bandwidth, bufferAheadS: bufferAhead,
      // The upstream decision treats zero as "not measured" and falls back to
      // the whole transfer. Timer samples can establish actual zero goodput;
      // a positive floor preserves that observation instead of its past burst.
      inflight: [{ total: range.length, loaded, startedAt, firstByteAt, rateBps: firstByteAt ? Math.max(Number.EPSILON, rate) : rate }],
      estimateBps: stats.est.estimate(), measuredBytes: stats.est.bytes(), measuredMs: stats.est.ms(),
      recentErrors: stats.errors.filter(time => now - time < routing.ERROR_WINDOW_MS).length,
    });
    if (verdict && !route.racing && !routedController.signal.aborted) {
      // Leave time for a measured backup to send bytes before Shaka's 5s stall deadline.
      // Continuous trickle can miss the playback deadline without a no-data gap.
      // Keep 3s of runway for the bounded 2s race and the resumed transfer.
      const trigger = lastByteAt !== null && now - lastByteAt >= 1500 ? 'no-data-gap'
        : verdict.trigger === 'stuck' && bufferAhead < 3 && !deadlineRaced ? 'buffer-deadline' : verdict.trigger;
      if (trigger === 'buffer-deadline') deadlineRaced = true;
      race(route, host, range, rate, trigger, headers, networkFetch, clientSignal).then(next => {
        if (next) {
          route.retry = next;
          routedController.abort(new Error('media fragment moved to measured winner'));
        }
      }, error => routedController.abort(error));
    }
  }, 250) : null;
  return {
    chunk(bytes) { lastByteAt = performance.now(); firstByteAt ||= lastByteAt; loaded += bytes; samples.push([lastByteAt, loaded]); },
    complete() { stats.est.sample(performance.now() - startedAt, loaded); if (loaded >= 128000) route.measured[host] = true; },
    stop() { clearInterval(timer); },
    async failed() {
      stats.errors.push(performance.now());
      route.failed[host] = (route.failed[host] || 0) + 1;
      if (useful && !clientSignal.aborted && !routedController.signal.aborted) {
        const next = await race(route, host, range, 0, 'incomplete-fragment', headers, networkFetch, clientSignal);
        if (next) route.retry = next;
      }
    },
  };
}
