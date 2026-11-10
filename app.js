// Reason-2 time-to-forecaster planner. Everything on the page is computed here, in the browser, by core/latency.mjs.
import * as C from './core/latency.mjs';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (p) p.appendChild(e); return e; };
const tip = $('tip');
const showTip = (e, h) => { tip.innerHTML = h; tip.style.display = 'block'; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 12 + 'px'; };
const hideTip = () => { tip.style.display = 'none'; };
const fmtMin = m => !Number.isFinite(m) ? '> 14 d' : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`;
const pct = x => Math.round(x * 100) + '%';
const ST = Object.fromEntries(C.STATIONS.map(s => [s.id, s]));
const OPT = C.STATIONS.filter(s => s.type === 'opt');

// ---------- compute ----------
const o = C.orbit(), cts = C.contacts(o), times = C.chunkTimes();
const train = C.cloudSet(C.CFG.realizations * C.CFG.trainFrac, 0), test = C.cloudSet(C.CFG.realizations * (1 - C.CFG.trainFrac), 500);
const S = {
  raw: C.evaluate('raw', [], cts, test, times),
  laser: C.evaluate('optical', C.BASE_NETWORK, cts, test, times),
  every: C.evaluate('multilink', C.BASE_NETWORK, cts, test, times),
};
const G = C.greedy(C.BASE_NETWORK, 3, cts, train, times);
const baseObj = C.objective(C.BASE_NETWORK, cts, test, times);
const single = Object.fromEntries(OPT.filter(s => !C.BASE_NETWORK.includes(s.id)).map(s => [s.id, C.objective([...C.BASE_NETWORK, s.id], cts, test, times) - baseObj]));
let network = [...G.chosen], prod = 'mirs';
S.mine = C.evaluate('multilink', network, cts, test, times);
const optimized = C.evaluate('multilink', G.chosen, cts, test, times);

const SCEN = [
  ['raw', 'Raw RF downlink + ground processing (today)', '#9c9791', '4 3'],
  ['laser', 'Onboard CSPP + laser only · 3 sites', '#7d8fb0', ''],
  ['every', 'Onboard + every link · 3 sites', '#dbd4cd', ''],
  ['mine', 'Onboard + every link · selected network', '#ff7443', ''],
];

// ---------- text ----------
function renderText() {
  const P = C.PRODUCTS.find(p => p.id === prod), r = S.raw[prod], l = S.laser[prod], m = S.mine[prod];
  $('lede').innerHTML = `Reason-2 runs NOAA's CSPP and MiRS on GPUs in orbit and sends products down a 25 Gbps laser. Lasers stop at clouds. Over ${C.CFG.realizations * (1 - C.CFG.trainFrac)} simulated two-week weather histories, a laser-only downlink to three mid-latitude sites puts the median ${P.id === 'mirs' ? 'MiRS sounding' : P.id === 'fire' ? 'fire alert' : 'VIIRS image'} on a forecaster's screen <em>${fmtMin(l.p50)}</em> after collection, slower than today's raw RF downlink (<b>${fmtMin(r.p50)}</b>). Sending small products over every link and adding the stations the optimizer picks brings it to <em>${fmtMin(m.p50)}</em>.`;
  $('kpis').innerHTML = [
    ['hi', 'MEDIAN TIME TO FORECASTER', m.p50, `selected network, every link · <b>${(r.p50 / m.p50).toFixed(1)}×</b> faster than raw RF`],
    ['', 'P90 TIME TO FORECASTER', m.p90, `raw RF today: <b>${fmtMin(r.p90)}</b> · laser only: <b>${fmtMin(l.p90)}</b>`],
    ['', `ON TIME (≤ ${P.deadlineMin} MIN)`, null, `raw RF: <b>${pct(r.onTime)}</b> · laser only, 3 sites: <b>${pct(l.onTime)}</b>`, m.onTime],
    ['', 'LASER ONLY · 3 SITES', l.p50, `median; clouds block <b>${pct(cloudBlock())}</b> of laser passes`],
  ].map(([cls, k, v, s, frac]) => `<div class="kpi ${cls}"><div class="eyebrow">${k}</div><div class="v">${frac !== undefined ? Math.round(frac * 100) + '<small>%</small>' : fmtSplit(v)}</div><div class="s">${s}</div></div>`).join('');
}
function fmtSplit(m) { return m < 90 ? `${Math.round(m)}<small>min</small>` : `${(m / 60).toFixed(1)}<small>h</small>`; }
function cloudBlock() {
  let n = 0, c = 0;
  for (const cl of test) for (const id of C.BASE_NETWORK) for (const [a] of cts[id]) { n++; if (!C.isClear(cl, id, a)) c++; }
  return c / n;
}

// ---------- map ----------
let land = null;
fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json').then(r => r.json()).then(t => { land = topojson.feature(t, t.objects.land); renderMap(); }).catch(() => renderMap());
function renderMap() {
  const W = 720, H = 360, x = lon => (lon + 180) / 360 * W, y = lat => (90 - lat) / 180 * H;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#1b1208', rx: 8 }, svg);
  for (let g = -60; g <= 60; g += 30) el('line', { x1: 0, x2: W, y1: y(g), y2: y(g), stroke: 'rgba(219,212,205,.07)' }, svg);
  for (let g = -150; g <= 150; g += 30) el('line', { y1: 0, y2: H, x1: x(g), x2: x(g), stroke: 'rgba(219,212,205,.07)' }, svg);
  if (land) {
    let d = '';
    const ring = r => { let s = ''; r.forEach(([lo, la], i) => { s += (i ? 'L' : 'M') + x(lo).toFixed(1) + ',' + y(la).toFixed(1); }); return s + 'Z'; };
    for (const f of land.features) { const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const p of polys) for (const r of p) d += ring(r); }
    el('path', { d, fill: '#3a2c1b', stroke: 'rgba(219,212,205,.18)', 'stroke-width': .5 }, svg);
  }
  // ground track, first 24 h
  let d = '', prevLon = null;
  for (let t = 0; t <= 86400; t += 30) {
    const sp = C.subPoint(C.satEcef(o, t));
    const jump = prevLon !== null && Math.abs(sp.lon - prevLon) > 180;
    d += (d === '' || jump ? 'M' : 'L') + x(sp.lon).toFixed(1) + ',' + y(sp.lat).toFixed(1); prevLon = sp.lon;
  }
  el('path', { d, fill: 'none', stroke: 'rgba(255,116,67,.38)', 'stroke-width': 1 }, svg);
  for (const s of [...OPT, ...C.STATIONS.filter(q => q.type === 'rf')]) {
    const on = s.type === 'opt' && network.includes(s.id), X = x(s.lon) + (s.type === 'rf' ? -7 : 0), Y = y(s.lat);
    let m;
    if (s.type === 'rf') m = el('rect', { x: X - 4.5, y: Y - 4.5, width: 9, height: 9, fill: '#dbd4cd', rx: 1.5 }, svg);
    else m = el('circle', { cx: X, cy: Y, r: on ? 6 : 5, fill: on ? '#ff7443' : '#1f1509', stroke: on ? '#ff7443' : '#9c9791', 'stroke-width': 1.6 }, svg);
    m.style.cursor = s.type === 'opt' ? 'pointer' : 'default';
    m.onmousemove = e => showTip(e, `<b>${s.name}</b><br>${s.type === 'rf' ? 'RF (X/S-band), cloud independent' : `optical · clear ${pct(s.clear)} · ${(cts[s.id].length / C.CFG.days).toFixed(1)} passes/day`}<br>${(cts[s.id].length / C.CFG.days).toFixed(1)} contacts/day`);
    m.onmouseleave = hideTip;
    if (s.type === 'opt') m.onclick = () => toggle(s.id);
    if (on || s.type === 'rf') el('text', { x: s.type === 'rf' ? X - 8 : X + 9, 'text-anchor': s.type === 'rf' ? 'end' : 'start', y: Y + 4, style: `fill:${on ? '#f9f7f3' : '#dbd4cd'};font-size:10.5px` }, svg).textContent = s.name.replace(' (optical)', '');
  }
  $('map').replaceChildren(svg);
  $('orbit-tag').textContent = `${C.CFG.altKm} km SSO · ${C.CFG.incDeg}° · LTAN 13:30 · ${o.periodMin.toFixed(1)} min period`;
  $('map-leg').innerHTML = `<span><i class="sq" style="background:#dbd4cd"></i>RF station</span><span><i class="dot" style="background:#ff7443"></i>optical, in network</span><span><i class="dot" style="border:1.5px solid #9c9791"></i>optical candidate (click to toggle)</span><span><i style="background:rgba(255,116,67,.5)"></i>ground track</span>`;
}

// ---------- CDF ----------
function renderCdf() {
  $('prod-seg').innerHTML = C.PRODUCTS.map(p => `<button class="${p.id === prod ? 'on' : ''}" data-p="${p.id}">${p.id === 'fire' ? 'FIRE ALERTS' : p.id === 'mirs' ? 'MIRS' : 'IMAGERY'}</button>`).join('');
  $('prod-seg').querySelectorAll('button').forEach(b => b.onclick = () => { prod = b.dataset.p; renderAll(); });
  const P = C.PRODUCTS.find(p => p.id === prod);
  const W = 620, H = 330, L = 44, B = 34, T = 10, R = 12, lo = Math.log(5), hi = Math.log(720);
  const x = m => L + (Math.log(Math.max(5, Math.min(720, m))) - lo) / (hi - lo) * (W - L - R), y = v => T + (1 - v) * (H - T - B);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
  for (let v = 0; v <= 1.001; v += 0.25) { el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'rgba(219,212,205,.09)' }, svg); el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = pct(v); }
  for (const m of [5, 10, 15, 30, 60, 120, 240, 480, 720]) { el('line', { x1: x(m), x2: x(m), y1: T, y2: H - B, stroke: 'rgba(219,212,205,.05)' }, svg); el('text', { x: x(m), y: H - B + 16, 'text-anchor': 'middle' }, svg).textContent = m < 60 ? `${m}m` : `${m / 60}h`; }
  el('line', { x1: x(P.deadlineMin), x2: x(P.deadlineMin), y1: T, y2: H - B, stroke: '#f9f7f3', 'stroke-dasharray': '3 4' }, svg);
  el('text', { x: x(P.deadlineMin) + 5, y: T + 12, style: 'fill:#f9f7f3' }, svg).textContent = `deadline ${P.deadlineMin} min`;
  el('text', { x: W - R, y: H - 4, 'text-anchor': 'end' }, svg).textContent = 'minutes from collection to product on the ground (log scale)';
  for (const [k, name, col, dash] of SCEN) {
    const pts = [[5, 0], ...S[k][prod].cdf.filter(([g]) => g <= 720)];
    const path = pts.map(([g, v], i) => (i ? 'L' : 'M') + x(g).toFixed(1) + ',' + y(v).toFixed(1)).join('');
    el('path', { d: path, fill: 'none', stroke: col, 'stroke-width': k === 'mine' ? 2.8 : 2, 'stroke-dasharray': dash }, svg);
    pts.slice(1).forEach(([g, v]) => { const c = el('circle', { cx: x(g), cy: y(v), r: 6, fill: 'transparent' }, svg); c.onmousemove = e => showTip(e, `${name}<br>${pct(v)} delivered within ${g < 60 ? g + ' min' : g / 60 + ' h'}`); c.onmouseleave = hideTip; });
  }
  $('cdf').replaceChildren(svg);
  $('cdf-leg').innerHTML = SCEN.map(([k, n, c, d]) => `<span><i style="background:${c};${d ? 'opacity:.8' : ''}"></i>${n} · median ${fmtMin(S[k][prod].p50)}</span>`).join('');
}

// ---------- stations ----------
function toggle(id) {
  network = network.includes(id) ? network.filter(x => x !== id) : [...network, id];
  S.mine = C.evaluate('multilink', network, cts, test, times);
  renderAll();
}
function renderStations() {
  const pickIdx = Object.fromEntries(G.trace.slice(1).map((t, i) => [t.add, i + 1]));
  const rows = [...OPT].sort((a, b) => (network.includes(b.id) - network.includes(a.id)) || (C.BASE_NETWORK.includes(b.id) - C.BASE_NETWORK.includes(a.id)) || ((single[b.id] ?? 0) - (single[a.id] ?? 0)));
  const mx = Math.max(...Object.values(single));
  $('st-tbl').innerHTML = `<tr><th></th><th>SITE</th><th class="num">CLEAR</th><th class="num">PASSES/DAY</th><th>ON-TIME GAIN IF ADDED TO 3 SITES</th></tr>` + rows.map(s => {
    const on = network.includes(s.id), g = single[s.id];
    return `<tr class="${on ? 'on' : ''}"><td><span class="sw ${on ? 'on' : ''}" data-id="${s.id}"></span></td><td class="name">${s.name}${C.BASE_NETWORK.includes(s.id) ? '<span class="pick" style="color:#9c9791">BASE</span>' : ''}${pickIdx[s.id] ? `<span class="pick">PICK ${pickIdx[s.id]}</span>` : ''}</td><td class="num">${pct(s.clear)}</td><td class="num">${(cts[s.id].length / C.CFG.days).toFixed(1)}</td><td>${g === undefined ? '<span style="color:#76716a">in base network</span>' : `<span class="bar" style="width:${Math.max(2, g / mx * 110)}px"></span>+${(g * 100).toFixed(1)} pts`}</td></tr>`;
  }).join('');
  $('st-tbl').querySelectorAll('.sw').forEach(sw => sw.onclick = () => toggle(sw.dataset.id));
  const tr = G.trace;
  $('st-note').innerHTML = `Optimizer: lazy greedy over ${OPT.length - C.BASE_NETWORK.length} candidates, scored on ${train.length} training weather histories, reported on ${test.length} held-out ones. Picks: ${tr.slice(1).map(t => `<b>${ST[t.add].name}</b> (+${(t.gain * 100).toFixed(1)} pts)`).join(', ')}. Mean on-time across products: ${pct(tr[0].value)} → ${pct(tr.at(-1).value)} (training). High-latitude sites win on pass count even when cloudier.`;
}
$('opt-btn').textContent = 'Reset to optimizer picks';
$('opt-btn').onclick = () => { network = [...G.chosen]; S.mine = optimized; renderAll(); };

// ---------- contact strip ----------
function renderStrip() {
  const day = 3, cl = test[0], t0 = day * 1440, t1 = t0 + 1440;
  const rows = [...C.STATIONS.filter(s => s.type === 'rf'), ...OPT.filter(s => network.includes(s.id))];
  const W = 620, rh = 19, L = 128, R = 8, T = 6, H = T + rows.length * rh + 26;
  const x = t => L + (t - t0) / 1440 * (W - L - R);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
  rows.forEach((s, i) => {
    const yy = T + i * rh;
    el('text', { x: L - 8, y: yy + 13, 'text-anchor': 'end', style: `fill:${s.type === 'rf' ? '#dbd4cd' : '#f9f7f3'}` }, svg).textContent = s.name.replace(' (optical)', ' opt.');
    el('line', { x1: L, x2: W - R, y1: yy + 9.5, y2: yy + 9.5, stroke: 'rgba(219,212,205,.08)' }, svg);
    for (const [a, b] of cts[s.id]) {
      if (b < t0 || a > t1) continue;
      const clear = s.type === 'rf' || C.isClear(cl, s.id, a);
      const r = el('rect', { x: x(Math.max(a, t0)), y: yy + 3, width: Math.max(2.5, x(Math.min(b, t1)) - x(Math.max(a, t0))), height: 13, rx: 2, fill: s.type === 'rf' ? '#dbd4cd' : clear ? '#ff7443' : '#4a3a28', stroke: clear ? 'none' : '#76716a', 'stroke-width': 0.8 }, svg);
      r.onmousemove = e => showTip(e, `${s.name} · ${hm(a)}-${hm(b)} UTC<br>${s.type === 'rf' ? 'RF contact' : clear ? 'laser pass, clear' : 'laser pass, clouded out'}`); r.onmouseleave = hideTip;
    }
  });
  for (let h = 0; h <= 24; h += 3) el('text', { x: x(t0 + h * 60), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = String(h).padStart(2, '0') + ':00';
  $('strip').replaceChildren(svg);
  const date = new Date(Date.UTC(2027, 2, 20 + day));
  $('day-tag').textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + ' · weather history 1 of ' + test.length;
  $('strip-leg').innerHTML = `<span><i class="sq" style="background:#dbd4cd"></i>RF contact</span><span><i class="sq" style="background:#ff7443"></i>laser pass, clear</span><span><i class="sq" style="background:#4a3a28;border:1px solid #76716a"></i>laser pass, clouded out</span>`;
}
const hm = t => { const m = Math.round(t) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------- products ----------
function renderProducts() {
  $('prod-tbl').innerHTML = `<tr><th>PRODUCT</th><th class="num">SIZE</th><th class="num">DEADLINE</th><th class="num">RAW RF</th><th class="num">SELECTED</th><th class="num">ON TIME</th></tr>` + C.PRODUCTS.map(p => `<tr class="${p.id === prod ? 'on' : ''}"><td class="name">${p.name}<div style="color:#76716a;font-size:11.5px">${p.src}</div></td><td class="num">${p.mb < 1 ? p.mb * 1000 + ' KB' : p.mb >= 1000 ? p.mb / 1000 + ' GB' : p.mb + ' MB'}</td><td class="num">${p.deadlineMin} min</td><td class="num">${fmtMin(S.raw[p.id].p50)}</td><td class="num" style="color:#ff7443">${fmtMin(S.mine[p.id].p50)}</td><td class="num">${pct(S.mine[p.id].onTime)}</td></tr>`).join('');
}

function renderAll() { renderText(); renderMap(); renderCdf(); renderStations(); renderStrip(); renderProducts(); }
renderAll();
