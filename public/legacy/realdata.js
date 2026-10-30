/* =====================================================================
   Superfinancials — real-data mode, page add-ons
   Next.js port add-on, loaded last (src/components/LegacyApp.tsx).
   Real-data mode itself (REAL, realOK, removing the simulator's private
   companies and funds) lives in superfinancials.js, because it has to run
   before the first page renders. This file adjusts views that would
   otherwise show modelled figures as if they were reported:
     - Portfolio › Operating KPIs and Benchmarks: quarterly operating
       history is a model, so it is replaced by an explanation.
     - Company tearsheet: a notice that operating figures are estimates.
     - Fund performance: a "Funds raising now" list from SEC Form D filings
       (data desk kind 'raise'), kept apart from the performance table
       because Form D has no IRR, TVPI or DPI.
   The demo workspace (REAL.on false) is unchanged.
   ===================================================================== */
'use strict';
const REAL_KPI_NOTE = '<div class="callout info" style="margin:12px 0">Quarterly operating figures (revenue, margins, cash burn) are not connected for private companies yet, so this view is hidden rather than filled with model estimates. Valuations, rounds and your positions are on the other tabs. Operating data can be added per company by the data desk.</div>';
if (typeof PT_DRAW !== 'undefined') {
  for (const k of ['kpi', 'bm']) { const _d = PT_DRAW[k]; if (_d) PT_DRAW[k] = (el, ...a) => { if (REAL.on) { el.innerHTML = REAL_KPI_NOTE; return; } return _d(el, ...a); }; }
}
if (typeof PAGES !== 'undefined' && PAGES.tear) {
  const _t = PAGES.tear;
  PAGES.tear = (pg, p) => {
    _t(pg, p);
    try { if (!REAL.on || !PCOS.length) return; const h = pg.querySelector('.phd'); if (h) h.insertAdjacentHTML('afterend', '<div class="callout info">Revenue history, margins and the operating-highlights text on this page are model estimates built from the revenue the data desk recorded for this company, not reported quarterly results.</div>'); } catch (e) { console.error(e); }
  };
}
/* Government yields: the curve analytics need at least one country with real yields. */
if (typeof PAGES !== 'undefined' && PAGES.yields) {
  const _y = PAGES.yields;
  PAGES.yields = (pg, p) => {
    if (REAL.on && !YLD.length) { pg.innerHTML = hdr('yields') + '<section class="panel"><div class="empty"><b>No government yields have loaded yet</b>Yield curves appear here once the daily market sync has fetched real yields.</div></section>'; return; }
    return _y(pg, p);
  };
}
/* Market calendars: the simulator's central-bank meetings, auctions, dividends, shareholder meetings and economic
   releases are dropped. What stays: events from the data desk and the daily sync (FRED release dates, U.S. Treasury
   auctions, the economic / dividend / IPO calendars of the connected providers) and earnings dates from a provider. */
if (typeof calAll === 'function') {
  const _ca = calAll;
  calAll = function () {
    const ev = _ca();
    if (REAL.on && !ev.__real) { const keep = ev.filter(e => e.type === 'adm' || (e.type === 'earn' && typeof erHas === 'function' && e.co && erHas(e.co.id))); ev.splice(0, ev.length, ...keep); ev.__real = true; }
    return ev;
  };
}
/* Instruments the daily sync prices from World Bank monthly averages or SMARD's daily German spot price, not from
   the futures contract the simulator models: while those prices are present, name and venue say what they are. */
const REAL_RENAME = {
  'CM.TTF': ['European natural gas (TTF), monthly average', 'World Bank'], 'CM.JKM': ['Japan LNG import price, monthly', 'World Bank'],
  'CM.MTF': ['Australian thermal coal (Newcastle), monthly average', 'World Bank'], 'CM.ALI': ['Aluminium, monthly average', 'World Bank (LME)'],
  'CM.NI': ['Nickel, monthly average', 'World Bank (LME)'], 'CM.ZNC': ['Zinc, monthly average', 'World Bank (LME)'],
  'CM.TIO': ['Iron ore 62% Fe, monthly average', 'World Bank'], 'CM.FCPO': ['Palm oil (Malaysia), monthly average', 'World Bank'],
  'CM.UREA': ['Urea, monthly average', 'World Bank'], 'CM.DAP': ['DAP phosphate, monthly average', 'World Bank'],
  'CM.PWDE': ['German day-ahead power, daily average', 'SMARD / EPEX Spot'],
};
const REAL_ORIG = {};
function realRename() {
  try {
    for (const [id, [name, exch]] of Object.entries(REAL_RENAME)) {
      const o = typeof BY !== 'undefined' && BY[id]; if (!o) continue; REAL_ORIG[id] ??= { name: o.name, exch: o.exch, cls: o.cls };
      const synced = typeof ADM !== 'undefined' && ADM.I[id] && ADM.I[id].gen === 'macro-sync' && ADM.I[id].pts.length;
      Object.assign(o, synced && REAL.on ? { name, exch, cls: id === 'CM.PWDE' ? 'Day-ahead spot (daily average)' : 'Monthly average price' } : REAL_ORIG[id]);
    }
  } catch (e) { console.error(e); }
}
if (typeof admBuild === 'function') { const _ab = admBuild; admBuild = function (...a) { const r = _ab(...a); realRename(); return r; }; }
if (typeof loadUser === 'function') { const _lu = loadUser; loadUser = function (...a) { const r = _lu(...a); realRename(); return r; }; }
realRename();
/* ---------- Fund performance › funds raising now (SEC Form D, written by the daily macro sync) ---------- */
// Reg CF and Reg A offerings come from the SEC sync (src/lib/sec/sync.ts): companies raising from the public.
const RAISE_TYPES = ['All', 'Venture Capital Fund', 'Private Equity Fund', 'Hedge Fund', 'Other Investment Fund', 'Reg CF offering', 'Reg A offering'];
let RAISE_TYPE = 'All';
function raiseRows() { try { return (typeof ADM !== 'undefined' ? ADM.priv : []).filter(x => x.kind === 'raise' && x.name).sort((a, b) => String(b.filed || '').localeCompare(String(a.filed || ''))); } catch (e) { return []; } }
function raiseDraw(el) {
  const all = raiseRows(); const rows = all.filter(x => RAISE_TYPE === 'All' || x.fundType === RAISE_TYPE);
  const n30 = all.filter(x => Date.parse(x.filed) >= END - 30 * DAY).length;
  const amt = v => v == null || v === '' ? '<span class="muted">Indefinite</span>' : big(+v, '$');
  el.innerHTML = `<div class="pb row" style="padding-top:14px">${RAISE_TYPES.map(t => `<button class="chip ${t === RAISE_TYPE ? 'on' : ''}" data-rt="${esc(t)}">${esc(t === 'All' ? 'All' : t.replace(' Fund', ''))} <span class="sub">${t === 'All' ? all.length : all.filter(x => x.fundType === t).length}</span></button>`).join('')}</div><div id="rfT"></div><div class="pf"><span>${n30} new filings in the last 30 days. Each row is a fund's latest new Form D: the amount offered and the amount sold to date, as filed. Form D carries no performance figures, so these funds are not in the table below.</span><span>Source: SEC EDGAR Form D (public domain).</span></div>`;
  el.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => { RAISE_TYPE = b.dataset.rt; raiseDraw(el); }));
  table(el.querySelector('#rfT'), { dense: true, rows, csv: 'funds-raising-form-d', search: true, sort: { k: 'f', d: -1 }, text: x => x.name + ' ' + (x.people || []).join(' '), empty: '<b>No funds yet</b>The daily sync adds pooled-fund Form D filings here once SEC EDGAR is connected.',
    cols: [
      { k: 'n', h: 'Fund', v: x => x.name, f: x => `<a href="${esc(x.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a> <span class="badge live desk">DESK</span>${(x.people || []).length ? `<div class="sub">${esc(x.people.slice(0, 2).join('; '))}</div>` : ''}${x.platform ? `<div class="sub">via ${esc(x.platform)}</div>` : ''}`, csv: x => x.name },
      { k: 't', h: 'Type', v: x => x.fundType, f: x => `<span class="badge">${esc(String(x.fundType || '').replace(' Fund', ''))}</span>` },
      { k: 'p', h: 'Location', v: x => [x.city, x.state].filter(Boolean).join(', '), f: x => `<span class="sub">${esc([x.city, x.state].filter(Boolean).join(', '))}</span>` },
      { k: 'o', h: 'Offered', a: 'r', v: x => x.offered == null ? -1 : +x.offered, f: x => amt(x.offered) },
      { k: 's', h: 'Sold to date', a: 'r', v: x => +x.sold || 0, f: x => x.sold == null || x.sold === '' ? '—' : amt(x.sold) },
      { k: 'i', h: 'Investors', a: 'r', v: x => x.investors ?? -1, f: x => x.investors == null ? '—' : nf(x.investors, 0) },
      { k: 'm', h: 'Minimum', a: 'r', v: x => +x.minInvest || 0, f: x => x.minInvest ? big(+x.minInvest, '$') : '—' },
      { k: 'f', h: 'Filed', v: x => x.filed, f: x => `<span class="sub">${esc(x.filed ? fd(Date.parse(x.filed)) : '')}</span>` },
    ] });
}
if (typeof PAGES !== 'undefined' && PAGES.funds) {
  const _f = PAGES.funds;
  PAGES.funds = (pg, p) => {
    _f(pg, p);
    try {
      if (!raiseRows().length && !REAL.on) return;
      const h = pg.querySelector('.phd'); if (!h) return;
      h.insertAdjacentHTML('afterend', `<section class="panel" id="raiseP"><header class="ph"><span class="pt">Funds raising now</span><span class="pm">SEC Form D, Form C and Reg A · U.S. funds and companies</span></header><div id="raiseB"></div></section>`);
      raiseDraw(pg.querySelector('#raiseB'));
    } catch (e) { console.error(e); }
  };
}
