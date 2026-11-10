import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../core/latency.mjs';

const o = C.orbit();
test('orbit period and inclination are physical', () => {
  assert.ok(Math.abs(o.periodMin - 95.6) < 0.2, `period ${o.periodMin}`);
  let maxLat = 0, r0 = Math.hypot(...C.satEcef(o, 0));
  for (let t = 0; t < 6000; t += 10) { const p = C.satEcef(o, t); maxLat = Math.max(maxLat, Math.abs(C.subPoint(p).lat)); assert.ok(Math.abs(Math.hypot(...p) - r0) < 1e-6); }
  assert.ok(Math.abs(maxLat - (180 - C.CFG.incDeg)) < 0.2, `max latitude ${maxLat}`);
});
test('elevation is 90 deg overhead and negative on the far side', () => {
  const p = C.satEcef(o, 1234), sp = C.subPoint(p);
  assert.ok(Math.abs(C.elevationDeg({ lat: sp.lat, lon: sp.lon }, p) - 90) < 1e-6);
  assert.ok(C.elevationDeg({ lat: -sp.lat, lon: sp.lon + 180 }, p) < -60);
});
test('polar stations see far more passes than low-latitude ones', () => {
  const cts = C.contacts(o);
  assert.ok(cts['svalbard-rf'].length > 5 * cts['tenerife'].length);
  for (const w of Object.values(cts)) for (let i = 1; i < w.length; i++) assert.ok(w[i][0] >= w[i - 1][1]);
});
test('probit inverts the normal CDF', () => {
  assert.ok(Math.abs(C.probit(0.975) - 1.959964) < 1e-5); assert.ok(Math.abs(C.probit(0.5)) < 1e-9); assert.ok(Math.abs(C.probit(0.01) + 2.326348) < 1e-5);
});
test('cloud model hits each site clear fraction and correlates within a region', () => {
  const sets = C.cloudSet(80, 9000);
  for (const id of ['atacama', 'svalbard-ogs', 'matera']) {
    let c = 0, n = 0; for (const cl of sets) for (const v of cl[id]) { c += v; n++; }
    const target = C.STATIONS.find(s => s.id === id).clear;
    assert.ok(Math.abs(c / n - target) < 0.05, `${id}: ${c / n} vs ${target}`);
  }
  const corr = (a, b) => { let n = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0; for (const cl of sets) for (let h = 0; h < cl[a].length; h++) { const x = cl[a][h], y = cl[b][h]; n++; sa += x; sb += y; sab += x * y; saa += x * x; sbb += y * y; } const ca = sab / n - sa / n * sb / n; return ca / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2)); };
  assert.ok(corr('tenerife', 'matera') > 0.2, 'same region correlated');
  assert.ok(Math.abs(corr('tenerife', 'atacama')) < 0.08, 'different regions ~independent');
});
test('every-link delivery is never slower than laser-only, and more stations never hurt', () => {
  const cts = C.contacts(o), cl = C.clouds(77), times = C.chunkTimes().filter((_, i) => i % 7 === 0);
  const L3 = C.links(cts, C.BASE_NETWORK), L4 = C.links(cts, [...C.BASE_NETWORK, 'atacama']);
  for (const p of C.PRODUCTS) for (const t of times) {
    const m = C.deliver('multilink', p, t, L3, cl);
    assert.ok(m <= C.deliver('optical', p, t, L3, cl) + 1e-9);
    assert.ok(C.deliver('multilink', p, t, L4, cl) <= m + 1e-9);
    assert.ok(m >= C.CFG.onboardProcMin);
  }
});
test('lazy greedy matches brute force for two stations on a small problem', () => {
  const cts = C.contacts(o), sets = C.cloudSet(8, 4000), times = C.chunkTimes().filter((_, i) => i % 5 === 0);
  const cands = ['atacama', 'alice', 'troll', 'kiruna', 'hbk', 'matera'];
  const g = C.greedy(C.BASE_NETWORK, 1, cts, sets, times, cands), b = C.bruteForce(C.BASE_NETWORK, 1, cts, sets, times, cands);
  assert.equal(g.chosen.at(-1), b.set[0]);
  const g2 = C.greedy(C.BASE_NETWORK, 2, cts, sets, times, cands), b2 = C.bruteForce(C.BASE_NETWORK, 2, cts, sets, times, cands);
  assert.ok(b2.v - g2.trace.at(-1).value < 0.01, `greedy ${g2.trace.at(-1).value} vs best ${b2.v}`);
});
test('committed results reproduce', () => {
  const R = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url)));
  const cts = C.contacts(o), times = C.chunkTimes(), test = C.cloudSet(C.CFG.realizations * (1 - C.CFG.trainFrac), 500);
  const r = C.evaluate('optical', C.BASE_NETWORK, cts, test, times).mirs;
  assert.equal(+r.p50.toFixed(2), R.laser3.mirs.p50);
  assert.deepEqual(C.greedy(C.BASE_NETWORK, 3, cts, C.cloudSet(C.CFG.realizations * C.CFG.trainFrac, 0), times).chosen, R.greedy.chosen);
});
