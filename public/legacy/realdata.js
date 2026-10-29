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
