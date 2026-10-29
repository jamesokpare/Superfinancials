/* =====================================================================
   Superfinancials — reported earnings and consensus estimates
   Next.js port add-on, loaded after fundamentals.js
   (src/components/LegacyApp.tsx). Uses the quarterly earnings stored with each
   company's fundamentals (fund/<id>.earn, written by src/lib/fundamentals/:
   report dates and timing, reported EPS and revenue, consensus estimates, and
   the consensus trend for revisions) in place of the simulated schedule and
   surprises. It wraps the four functions every earnings feature uses:
     nxEarnDates · ceDates   report dates (next, then past)
     nxEarn                  EPS actual vs consensus, surprise, price reaction
     ceRecord                full earnings event for calendars and detail pages
   Price reactions are still measured from the app's price series. Companies
   without stored earnings keep the simulated schedule and labels.
   ===================================================================== */
'use strict';
const ER_DAY = 864e5;
const erT = d => Date.parse(d + 'T00:00:00Z');
/** The stored fundamentals doc when it has quarterly earnings, else null. */
function erDoc(id) { const R = typeof FDS !== 'undefined' ? FDS.m.get(id) : null; return R && Array.isArray(R.earn) && R.earn.length ? R : null; }
const erHas = id => !!erDoc(id);
/** Report dates with a reported EPS, newest first, up to the app's last session. */
function erPast(R) { return R.earn.filter(r => r.eps != null && erT(r.d) <= END).map(r => erT(r.d)).sort((a, b) => b - a); }
/** Next report date: the provider's upcoming report, else the last report plus a quarter. */
function erNext(R, id) {
  const up = R.earn.find(r => r.eps == null && erT(r.d) > END); if (up) return erT(up.d);
  const last = erPast(R)[0]; if (last) { let t = last + 91 * ER_DAY; while (t <= END) t += 91 * ER_DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t += ER_DAY; return t; }
  return fund(id).nextEarn;
}
const erRow = (R, t) => R.earn.find(r => erT(r.d) === t) || null;
/** Consensus EPS for the next report, when the provider has one. */
function erNextEst(id) { const R = erDoc(id); if (!R) return null; const r = erRow(R, erNext(R, id)); return r && r.est != null ? r.est : null; }
const ER_LABEL = { eodhd: 'EODHD', fmp: 'Financial Modeling Prep', alphavantage: 'Alpha Vantage' };
function erCoverage() { const n = EQ.filter(o => erHas(o.id)).length; return { n, of: EQ.length }; }

/* ---------- report dates ---------- */
if (typeof nxEarnDates === 'function') { const _d = nxEarnDates; nxEarnDates = id => { const R = erDoc(id); return R ? [erNext(R, id), ...erPast(R).slice(0, 3)] : _d(id); }; }
if (typeof ceDates === 'function') { const _c = ceDates; ceDates = (id, k = 9) => { const R = erDoc(id); return R ? [erNext(R, id), ...erPast(R).slice(0, k - 1)] : _c(id, k); }; }

/* ---------- one report: actual vs consensus, and the price reaction ---------- */
if (typeof nxEarn === 'function') {
  const _e = nxEarn;
  nxEarn = (id, t) => {
    const R = erDoc(id); if (!R) return _e(id, t);
    const row = erRow(R, t); const time = row && row.time ? row.time : 'Time not announced';
    const rt = row && row.time === 'Before open' ? t : nxNext(t); const done = rt != null && rt <= END;
    const act = row ? row.eps : null, cons = row ? row.est : null;
    const surp = act != null && cons ? (act - cons) / Math.abs(cons) * 100 : null;
    return { t, act, cons, surp, time, rt, rx: done ? nxChg(id, rt) : null, bx: done ? nxChg('IX.SPX', rt) : null, zx: done ? nxZ(id, rt) : null, real: true, src: ER_LABEL[R.src] || R.src };
  };
}

/* ---------- full earnings event (calendars, event pages, AI context) ---------- */
if (typeof ceRecord === 'function') {
  const _r = ceRecord;
  ceRecord = (id, t) => {
    const rec = _r(id, t); const R = erDoc(id); if (!R) return rec;
    const row = erRow(R, t); const e = nxEarn(id, t); const past = t <= END;
    const k = typeof fdFx === 'function' ? fdFx(R.ccy, (BY[id] && BY[id].ccy) || 'USD') ?? 1 : 1;
    const tr = R.earnTrend; const isNext = !past && row && tr && tr.now != null;
    const rev = v => v == null ? null : v * k;
    rec.d = {
      ...rec.d, real: true,
      epsCons: e.cons, epsAct: past ? e.act : null, surp: past ? e.surp : null,
      revCons: rev(row && row.revEst), revAct: past ? rev(row && row.rev) : null,
      revSurp: past && row && row.rev != null && row.revEst ? (row.rev / row.revEst - 1) * 100 : null,
      // Consensus revisions: change in the current-quarter EPS estimate over 7, 30 and 90 days.
      rev: [7, 30, 90].map(d => { const then = tr && tr['d' + d]; return { d, eps: isNext && then ? (tr.now / then - 1) * 100 : null, rev: null }; }),
    };
    const tm = row && row.time;
    rec.time = tm === 'Before open' ? [7, 0, 'America/New_York'] : [16, 5, 'America/New_York'];
    rec.at = atLocal(t, rec.time);
    rec.tl = tm === 'Before open' ? 'Before market open' : tm === 'After close' ? 'After market close' : 'Time not announced';
    rec.status = past ? 'Reported' : row ? (tm ? 'Confirmed' : 'Time TBD') : 'Estimated';
    rec.src = { name: `${ER_LABEL[R.src] || R.src}: reported results and consensus estimates`, kind: 'Reported' };
    // The app guesses fiscal quarters from the report date; with the real period end, name the quarter by its end month instead.
    if (row && row.p) { const lab = new Date(erT(row.p)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); rec.d.fq = lab; rec.title = `${rec.co.name} (${rec.co.tk}) earnings · quarter ended ${lab}`; }
    return rec;
  };
}
if (typeof FDS !== 'undefined' && typeof fdBuild === 'function') {
  // Cached earnings records depend on the stored docs; drop them when the docs change.
  const _b = fdBuild; fdBuild = docs => { _b(docs); if (typeof CAL_ALL !== 'undefined') CAL_ALL = null; };
}
