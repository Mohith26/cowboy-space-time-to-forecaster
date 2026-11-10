// Recomputes the headline numbers shown on the page and writes data/results.json.  node scripts/run.mjs
import * as C from '../core/latency.mjs';
import { writeFileSync } from 'node:fs';
const o = C.orbit(), cts = C.contacts(o), times = C.chunkTimes();
const train = C.cloudSet(C.CFG.realizations * C.CFG.trainFrac, 0), test = C.cloudSet(C.CFG.realizations * (1 - C.CFG.trainFrac), 500);
const G = C.greedy(C.BASE_NETWORK, 3, cts, train, times);
const pick = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { onTime: +v.onTime.toFixed(4), p50: +v.p50.toFixed(2), p90: +v.p90.toFixed(2) }]));
const out = {
  cfg: C.CFG, periodMin: +o.periodMin.toFixed(2), contactsPerDay: Object.fromEntries(Object.entries(cts).map(([k, v]) => [k, +(v.length / C.CFG.days).toFixed(2)])),
  greedy: G,
  raw: pick(C.evaluate('raw', [], cts, test, times)),
  laser3: pick(C.evaluate('optical', C.BASE_NETWORK, cts, test, times)),
  every3: pick(C.evaluate('multilink', C.BASE_NETWORK, cts, test, times)),
  optimized: pick(C.evaluate('multilink', G.chosen, cts, test, times)),
  laserOptimized: pick(C.evaluate('optical', G.chosen, cts, test, times)),
};
writeFileSync(new URL('../data/results.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ picks: G.chosen, raw: out.raw.mirs, laser3: out.laser3.mirs, every3: out.every3.mirs, optimized: out.optimized.mirs, laserOptimized: out.laserOptimized.mirs }));
