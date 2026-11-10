// Reason-2 time-to-forecaster planner (concept). Pure ES module, no dependencies.
//
// 1. orbit + contacts : circular sun-synchronous orbit, Earth rotation, elevation masks -> contact windows
// 2. clouds           : per-station clear/cloudy state from a Gaussian copula of hourly AR(1) latents,
//                       with a shared regional factor (correlated weather) and a persistence time
// 3. delivery         : for every 10-minute data chunk, when does each product reach the ground under
//                       (a) raw RF downlink + ground processing, (b) onboard processing + optical only,
//                       (c) onboard processing + every link (small products also ride RF)
// 4. network design   : greedy (lazy) selection of optical stations maximizing on-time delivery over
//                       Monte Carlo cloud histories, scored on held-out histories; checked vs brute force

export const CFG = {
  altKm: 550, incDeg: 97.6, ltanHours: 13.5,
  days: 14, stepS: 20,
  rfMaskDeg: 5, optMaskDeg: 20,
  persistenceH: 8, regionRho: 0.6,
  chunkMin: 10, onboardProcMin: 4, groundProcMin: 20,
  xbandMbps: 300, sbandMbps: 2, opticalGbps: 25,
  realizations: 120, trainFrac: 0.5,
  seed: 2027,
};
const RE = 6378.137, MU = 398600.4418, OMEGA_E = 7.2921159e-5, D2R = Math.PI / 180;

export const PRODUCTS = [
  { id: 'fire', name: 'Active fire alerts', src: 'VIIRS AF (CSPP LEO)', mb: 0.05, deadlineMin: 15 },
  { id: 'mirs', name: 'MiRS soundings', src: 'ATMS (MiRS)', mb: 25, deadlineMin: 30 },
  { id: 'imagery', name: 'VIIRS imagery + cloud mask', src: 'VIIRS SDR/EDR (CSPP LEO)', mb: 1500, deadlineMin: 60 },
];
export const RAW_MB_PER_CHUNK = 800;

// type: 'rf' (X/S-band, cloud independent) or 'opt' (optical ground station candidate)
// clear: assumed long-run clear-line-of-sight fraction; region: shares a weather factor
export const STATIONS = [
  { id: 'svalbard-rf', name: 'Svalbard', type: 'rf', lat: 78.23, lon: 15.39 },
  { id: 'fairbanks-rf', name: 'Fairbanks', type: 'rf', lat: 64.86, lon: -147.85 },
  { id: 'mcmurdo-rf', name: 'McMurdo', type: 'rf', lat: -77.85, lon: 166.67 },
  { id: 'table-mtn', name: 'Table Mountain, CA', type: 'opt', lat: 34.38, lon: -117.68, clear: 0.70, region: 'na-west' },
  { id: 'haleakala', name: 'Haleakala, HI', type: 'opt', lat: 20.71, lon: -156.26, clear: 0.62, region: 'pacific' },
  { id: 'tenerife', name: 'Tenerife, ES', type: 'opt', lat: 28.30, lon: -16.51, clear: 0.68, region: 'eu-atl' },
  { id: 'matera', name: 'Matera, IT', type: 'opt', lat: 40.65, lon: 16.70, clear: 0.55, region: 'eu-atl' },
  { id: 'atacama', name: 'Atacama, CL', type: 'opt', lat: -24.63, lon: -70.40, clear: 0.85, region: 'sa-west' },
  { id: 'alice', name: 'Alice Springs, AU', type: 'opt', lat: -23.70, lon: 133.88, clear: 0.75, region: 'aus' },
  { id: 'stromlo', name: 'Mt Stromlo, AU', type: 'opt', lat: -35.32, lon: 149.01, clear: 0.50, region: 'aus' },
  { id: 'hbk', name: 'Hartebeesthoek, ZA', type: 'opt', lat: -25.89, lon: 27.69, clear: 0.68, region: 'africa-s' },
  { id: 'svalbard-ogs', name: 'Svalbard (optical)', type: 'opt', lat: 78.23, lon: 15.39, clear: 0.30, region: 'arctic-eu' },
  { id: 'kiruna', name: 'Kiruna, SE', type: 'opt', lat: 67.86, lon: 20.96, clear: 0.33, region: 'arctic-eu' },
  { id: 'fairbanks-ogs', name: 'Fairbanks (optical)', type: 'opt', lat: 64.86, lon: -147.85, clear: 0.36, region: 'alaska' },
  { id: 'troll', name: 'Troll, AQ', type: 'opt', lat: -72.01, lon: 2.53, clear: 0.55, region: 'antarctic' },
];
export const BASE_NETWORK = ['table-mtn', 'tenerife', 'haleakala']; // assumed starting optical network

// ---------- randomness ----------
export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
// inverse standard normal CDF (Acklam)
export function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------- 1. orbit and contacts ----------
export function orbit() {
  const a = RE + CFG.altKm, n = Math.sqrt(MU / (a * a * a)), inc = CFG.incDeg * D2R;
  // epoch 2027-03-20 00:00 UTC (equinox): sun RA = 0, GMST ~ 178 deg; LTAN sets RAAN
  const raan0 = (CFG.ltanHours - 12) * 15 * D2R, gmst0 = 178.0 * D2R, raanDot = 2 * Math.PI / (365.2422 * 86400);
  return { a, n, inc, raan0, gmst0, raanDot, periodMin: 2 * Math.PI / n / 60 };
}
// satellite position in Earth-fixed frame at t seconds after epoch
export function satEcef(o, t) {
  const u = o.n * t, raan = o.raan0 + o.raanDot * t;
  const xo = Math.cos(u), yo = Math.sin(u);
  const x = o.a * (xo * Math.cos(raan) - yo * Math.cos(o.inc) * Math.sin(raan));
  const y = o.a * (xo * Math.sin(raan) + yo * Math.cos(o.inc) * Math.cos(raan));
  const z = o.a * (yo * Math.sin(o.inc));
  const th = o.gmst0 + OMEGA_E * t, c = Math.cos(th), s = Math.sin(th);
  return [c * x + s * y, -s * x + c * y, z];
}
export function subPoint(p) { return { lat: Math.asin(p[2] / Math.hypot(...p)) / D2R, lon: Math.atan2(p[1], p[0]) / D2R }; }
export function elevationDeg(st, p) {
  const la = st.lat * D2R, lo = st.lon * D2R, up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const g = [RE * up[0], RE * up[1], RE * up[2]], d = [p[0] - g[0], p[1] - g[1], p[2] - g[2]], L = Math.hypot(...d);
  return Math.asin(Math.max(-1, Math.min(1, (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / L))) / D2R;
}
// contact windows [start, end] in minutes for every station
export function contacts(o = orbit(), stations = STATIONS) {
  const out = Object.fromEntries(stations.map(s => [s.id, []]));
  const open = {};
  const T = CFG.days * 86400;
  for (let t = 0; t <= T; t += CFG.stepS) {
    const p = satEcef(o, t);
    for (const s of stations) {
      const vis = elevationDeg(s, p) >= (s.type === 'rf' ? CFG.rfMaskDeg : CFG.optMaskDeg);
      if (vis && open[s.id] === undefined) open[s.id] = t;
      else if (!vis && open[s.id] !== undefined) { out[s.id].push([open[s.id] / 60, t / 60]); delete open[s.id]; }
    }
  }
  return out;
}

// ---------- 2. correlated clouds ----------
// clear[station][hour] for one realization. Latent z = sqrt(rho) * Z_region + sqrt(1 - rho) * e_station,
// each an AR(1) with phi = exp(-1 / persistence); clear if z < probit(clear fraction).
export function clouds(seed, stations = STATIONS) {
  const r = mulberry32(seed), H = CFG.days * 24 + 1, phi = Math.exp(-1 / CFG.persistenceH), sd = Math.sqrt(1 - phi * phi);
  const regions = [...new Set(stations.filter(s => s.region).map(s => s.region))];
  const ar = () => { const x = new Float64Array(H); x[0] = gauss(r); for (let h = 1; h < H; h++) x[h] = phi * x[h - 1] + sd * gauss(r); return x; };
  const Z = Object.fromEntries(regions.map(g => [g, ar()]));
  const out = {};
  for (const s of stations) {
    if (s.type !== 'opt') continue;
    const e = ar(), k = probit(s.clear), rho = CFG.regionRho, z = Z[s.region];
    const c = new Uint8Array(H);
    for (let h = 0; h < H; h++) c[h] = Math.sqrt(rho) * z[h] + Math.sqrt(1 - rho) * e[h] < k ? 1 : 0;
    out[s.id] = c;
  }
  return out;
}
export const isClear = (cl, id, tMin) => cl[id][Math.min(cl[id].length - 1, Math.floor(tMin / 60))] === 1;

// ---------- 3. delivery ----------
export function mergedWindows(cts, ids) { return ids.flatMap(id => cts[id].map(w => [w[0], w[1], id])).sort((x, y) => x[0] - y[0]); }

// first index i with wins[i][1] >= t (window lists are sorted by start; ends are monotone for one satellite)
function lowerEnd(wins, t) { let lo = 0, hi = wins.length; while (lo < hi) { const m = (lo + hi) >> 1; if (wins[m][1] < t) lo = m + 1; else hi = m; } return lo; }
export function links(cts, network) {
  const rfIds = STATIONS.filter(s => s.type === 'rf').map(s => s.id);
  return { rf: mergedWindows(cts, rfIds), opt: mergedWindows(cts, network) };
}
// latency (minutes) for one chunk ready at tReady (end of collection), for one product
export function deliver(policy, prod, tReady, L, cl) {
  if (policy === 'raw') {
    const xfer = RAW_MB_PER_CHUNK * 8 / CFG.xbandMbps / 60;
    return scan(L.rf, tReady, xfer) + CFG.groundProcMin - tReady;
  }
  const t0 = tReady + CFG.onboardProcMin;
  const xo = prod.mb * 8 / (CFG.opticalGbps * 1000) / 60;
  let best = scan(L.opt, t0, xo, (start, id) => isClear(cl, id, start));
  if (policy === 'multilink') { // the same product also goes out over RF (S-band for alerts, X-band otherwise)
    const rate = prod.mb < 1 ? CFG.sbandMbps : CFG.xbandMbps;
    best = Math.min(best, scan(L.rf, t0, prod.mb * 8 / rate / 60));
  }
  return best - tReady;
}
function scan(wins, t, xfer, ok) {
  for (let i = lowerEnd(wins, t + xfer); i < wins.length; i++) {
    const [a, b, id] = wins[i];
    if (b < t + xfer) continue;
    const start = Math.max(a, t);
    if (start + xfer > b) continue;
    if (ok && !ok(start, id)) continue;
    return start + xfer;
  }
  return Infinity;
}

export function chunkTimes() { const out = []; for (let t = CFG.chunkMin; t < (CFG.days - 1) * 1440; t += CFG.chunkMin) out.push(t); return out; }

// Summary over realizations for a policy and network.
export function evaluate(policy, network, cts, cloudSets, times = chunkTimes()) {
  const res = {}, L = links(cts, network);
  for (const p of PRODUCTS) {
    const lat = [];
    for (const cl of cloudSets) for (const t of times) lat.push(deliver(policy, p, t, L, cl));
    lat.sort((a, b) => a - b);
    const q = f => lat[Math.min(lat.length - 1, Math.floor(f * lat.length))];
    res[p.id] = { n: lat.length, onTime: lat.filter(x => x <= p.deadlineMin).length / lat.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), cdf: cdfPoints(lat) };
  }
  return res;
}
export function cdfPoints(sorted, grid = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720]) {
  return grid.map(g => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= g) lo = m + 1; else hi = m; } return [g, lo / sorted.length]; });
}

// ---------- 4. network design ----------
// objective: mean on-time fraction across products (equal weight), multilink policy
export function objective(network, cts, cloudSets, times) {
  const r = evaluate('multilink', network, cts, cloudSets, times);
  return PRODUCTS.reduce((s, p) => s + r[p.id].onTime, 0) / PRODUCTS.length;
}
// Greedy forward selection of k stations added to `base` (lazy evaluation of marginal gains).
export function greedy(base, k, cts, cloudSets, times, candidates = STATIONS.filter(s => s.type === 'opt').map(s => s.id)) {
  let chosen = [...base], cur = objective(chosen, cts, cloudSets, times);
  const trace = [{ add: null, value: cur }];
  let gains = candidates.filter(c => !chosen.includes(c)).map(c => ({ c, g: Infinity }));
  for (let step = 0; step < k; step++) {
    while (true) {
      gains.sort((a, b) => b.g - a.g);
      const top = gains[0];
      const v = objective([...chosen, top.c], cts, cloudSets, times) - cur;
      top.g = v;
      gains.sort((a, b) => b.g - a.g);
      if (gains[0] === top) break; // still the best after recomputing: lazy greedy is exact for this step
    }
    const best = gains.shift();
    chosen.push(best.c); cur += best.g;
    trace.push({ add: best.c, value: cur, gain: best.g });
  }
  return { chosen, trace };
}
export function bruteForce(base, k, cts, cloudSets, times, candidates) {
  const pool = candidates.filter(c => !base.includes(c)); let best = { v: -1, set: null };
  const rec = (start, pick) => {
    if (pick.length === k) { const v = objective([...base, ...pick], cts, cloudSets, times); if (v > best.v) best = { v, set: [...pick] }; return; }
    for (let i = start; i < pool.length; i++) rec(i + 1, [...pick, pool[i]]);
  };
  rec(0, []);
  return best;
}
export function cloudSet(n, offset = 0) { return Array.from({ length: n }, (_, i) => clouds(CFG.seed * 1000 + offset + i)); }
