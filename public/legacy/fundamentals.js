/* =====================================================================
   Superfinancials — reported fundamentals for U.S. equities
   Next.js port add-on, loaded after superfinancials.js
   (src/components/LegacyApp.tsx). Reads the `fund` collection written by the
   server's fundamentals sync (src/lib/fundamentals/sync.ts: EODHD, FMP or
   Alpha Vantage) and replaces the simulated figures from fund(id) with
   reported ones. Valuation ratios are recomputed from the live price, so they
   move with the market. Every consumer of fund() picks this up: security
   pages, the screener, valuation comps, calendars and the AI context.
   Companies without stored data keep their simulated figures and labels.
   ===================================================================== */
'use strict';
const FDS = { m: new Map(), meta: null, st: 'idle', sig: '' };
const FD_LS = 'sf.fund.v1';
const FD_SRC = { eodhd: 'EODHD', fmp: 'Financial Modeling Prep', alphavantage: 'Alpha Vantage' };

function fdBuild(docs) {
  FDS.m = new Map(); FDS.meta = null;
  for (const { x } of docs) {
    if (!x || typeof x !== 'object') continue;
    if (x.type === 'meta') FDS.meta = x;
    else if (x.type === 'fund' && BY[x.id] && BY[x.id].type === 'equity' && Array.isArray(x.fy) && x.fy.length >= 2 && x.ttm && x.bs) FDS.m.set(x.id, x);
  }
  if (typeof FUND !== 'undefined') FUND.clear();
}

/** Multiplier from the reporting currency to USD, using the app's own FX rates. */
function fdFx(ccy) {
  if (!ccy || ccy === 'USD') return 1;
  const id = typeof FXUSD !== 'undefined' ? FXUSD[ccy] : null; if (!id || !BY[id]) return null;
  const r = quote(id).last; if (!r) return null;
  return /^FX\.USD/.test(id) ? 1 / r : r;
}

if (typeof fund === 'function') {
  const _fund = fund;
  fund = function (id) {
    if (FUND.has(id)) return FUND.get(id);
    const sim = _fund(id); const R = FDS.m.get(id);
    if (!sim || !R) return sim;
    const k = fdFx(R.ccy); if (k == null) return sim;
    const mv = v => (v == null || !isFinite(v) ? null : v * k);
    const pct = (a, b) => (a != null && b ? a / b * 100 : null);
    const T = R.ttm, B = R.bs; const px = quote(id).last;
    const shares = R.shares > 0 ? R.shares : null;
    const mcap = shares ? px * shares : sim.mcap;
    const rev = mv(T.rev), ni = mv(T.ni), eq = mv(B.equity), debt = mv(B.debt), cash = mv(B.cash), ebitda = mv(T.ebitda), fcf = mv(T.fcf);
    const eps = T.eps != null ? T.eps * k : ni != null && shares ? ni / shares : null;
    const ne = R.nextEarn ? Date.parse(R.nextEarn) : NaN;
    const f = {
      ...sim, mcap, rev, ni, eps,
      pe: eps > 0 ? px / eps : null,
      fpe: R.fwdEps > 0 ? px / (R.fwdEps * k) : null,
      ps: rev > 0 ? mcap / rev : null,
      pb: eq > 0 ? mcap / eq : null,
      evE: ebitda > 0 ? (mcap + (debt || 0) - (cash || 0)) / ebitda : null,
      div: T.divPs > 0 && px ? T.divPs * k / px * 100 : 0,
      roe: eq > 0 && ni != null ? ni / eq * 100 : null,
      gm: pct(mv(T.gp), rev), om: pct(mv(T.op), rev), nm: pct(ni, rev),
      gr: R.growth != null && isFinite(R.growth) ? R.growth : null,
      fcfY: fcf != null && mcap ? fcf / mcap * 100 : null,
      debtEq: eq > 0 && debt != null ? debt / eq : null,
      beta: sim.beta,
      nextEarn: isFinite(ne) && ne >= END ? ne : sim.nextEarn,
      earnTime: isFinite(ne) && ne >= END ? (R.earnTime || 'Time not announced') : sim.earnTime,
      fy: R.fy.map(y => ({ y: y.y, rev: mv(y.rev), gp: mv(y.gp), op: mv(y.op), ni: mv(y.ni), eps: y.eps == null ? null : y.eps * k, assets: mv(y.assets), debt: mv(y.debt), equity: mv(y.equity), fcf: mv(y.fcf) })),
      real: { src: R.src, label: FD_SRC[R.src] || R.src, asOf: Date.parse(R.asOf), ccy: R.ccy, basis: T.basis, fyEnd: R.fy[R.fy.length - 1].end, earnReal: isFinite(ne) && ne >= END },
    };
    FUND.set(id, f); return f;
  };
}

/* ---------- labels (called from the patched lines in superfinancials.js) ---------- */
function fdFinNote(o, f) {
  const r = f.real; const conv = r.ccy && r.ccy !== 'USD' ? ` Reported in ${esc(r.ccy)}; converted to USD at the current rate.` : '';
  return `<div class="callout fd-ok" style="margin-bottom:8px">Reported results from <b>${esc(r.label)}</b> · fiscal years ending ${fd(Date.parse(r.fyEnd), { day: 'numeric', month: 'long' })} · updated ${fd(r.asOf)}.${conv} Valuation ratios use the latest price; ${r.basis === 'TTM' ? 'income figures are trailing twelve months' : 'income figures are from the latest fiscal year'}.</div>`;
}
function fdPeerNote(f, peers) {
  const n = peers.filter(p => p && p.real).length;
  if (!n) return 'Simulated fundamentals.';
  return n === peers.length ? `Reported fundamentals (${esc([...new Set(peers.map(p => p.real.label))].join(', '))}).` : `Reported fundamentals for ${n} of ${peers.length} names; the rest are simulated.`;
}
function fdCoverage() {
  const n = EQ.filter(o => FDS.m.has(o.id)).length;
  return !n ? 'simulated fundamentals' : n === EQ.length ? 'reported fundamentals' : `fundamentals (reported for ${n} of ${EQ.length}; simulated for the rest)`;
}
if (typeof secStats === 'function') {
  const _ss = secStats;
  secStats = function (o, q, raw) {
    const kv = _ss(o, q, true);
    if (o.type === 'equity' && Array.isArray(kv)) {
      const f = fund(o.id);
      if (f && f.real) kv.push(['Fundamentals', `<span class="badge ok">REPORTED</span> ${esc(f.real.label)} · FY to ${fd(Date.parse(f.real.fyEnd))}`]);
      else if (FDS.m.size) kv.push(['Fundamentals', '<span class="badge sim">SIM</span> not yet loaded for this company']);
      if (f && f.real && !f.real.earnReal) { const i = kv.findIndex(([k]) => k === 'Next earnings'); if (i >= 0) kv[i][1] += ' (simulated)'; }
    }
    if (raw) return kv;
    return `<dl class="kv" style="margin:0">${kv.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd title="${esc(String(v).replace(/<[^>]+>/g, ''))}">${v}</dd></div>`).join('')}</dl>`;
  };
}

/* ---------- loading: cached copy first, then the live database ---------- */
try { const c = JSON.parse(localStorage.getItem(FD_LS) || 'null'); if (c && Array.isArray(c.docs)) { fdBuild(c.docs); FDS.sig = c.sig || ''; FDS.st = 'cached'; } } catch (e) { }
async function fdConnect() {
  try {
    const db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null;
    if (!db) { if (FDS.st !== 'cached') FDS.st = 'off'; return; }
    db.collection('fund').onSnapshot(snap => {
      const docs = snap.docs.filter(d => d.exists !== false).map(d => ({ id: d.id, x: d.data() }));
      const sig = docs.map(d => d.id + ':' + (d.x?.asOf || d.x?.checked || '') + ':' + (d.x?.nextEarn || '')).sort().join('|');
      FDS.st = 'on'; if (sig === FDS.sig) return; FDS.sig = sig; fdBuild(docs);
      try { localStorage.setItem(FD_LS, JSON.stringify({ sig, docs })); } catch (e) { }
      if (typeof state !== 'undefined' && state.r && document.querySelector('#main .page') && !document.querySelector('.modal, .ovl.open') && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) { try { render(); } catch (e) { console.error(e); } }
    }, () => { if (FDS.st !== 'cached') FDS.st = 'off'; });
  } catch (e) { if (FDS.st !== 'cached') FDS.st = 'off'; }
}
setTimeout(fdConnect, 0);
