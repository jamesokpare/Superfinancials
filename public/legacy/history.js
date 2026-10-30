/* =====================================================================
   Superfinancials — price history on demand
   Next.js port add-on, loaded right after superfinancials.js
   (src/components/LegacyApp.tsx). The `mkt` collection every browser loads
   now holds only recent daily closes, the run summary and an index of
   instruments with history (mkt/_hist). Each instrument's daily history lives
   in mkthist/<id> (written by src/lib/market/sync.ts) and is fetched the first
   time its series is used, in batches. The app then rebuilds its live data,
   drops cached series and re-renders, so charts extend with real history a
   moment after a page opens.
   ===================================================================== */
'use strict';
const LH = { idx: null, loaded: new Map(), pending: new Set(), queue: new Set(), timer: null, base: [], db: undefined, fails: 0, renderTries: 0, renderT: null };
const lhIndex = docs => { const d = (docs || []).find(d => d && d.x && d.x.type === 'histidx'); return d ? d.x.ids || {} : null; };
/** Loaded history as the `hist` documents liveBuild already understands. */
function lhDocs() {
  const out = [];
  for (const [id, parts] of LH.loaded) for (const [src, p] of Object.entries(parts || {})) if (p && Array.isArray(p.c) && p.t0) out.push({ id: 'h-' + id + '@' + src, lh: true, x: { type: 'hist', id, src, t0: p.t0, c: p.c, dd: Array.isArray(p.dd) ? p.dd : [], o: p.o, h: p.h, l: p.l, v: p.v } });
  return out;
}
if (typeof liveBuild === 'function') {
  const _lb = liveBuild;
  liveBuild = docs => { LH.base = (docs || []).filter(d => !d.lh); LH.idx = lhIndex(LH.base) || LH.idx; _lb([...LH.base, ...lhDocs()]); };
  // The cached copy was built before this add-on loaded; pick up its index now.
  if (typeof LIVE !== 'undefined' && LIVE.docs) { LH.base = LIVE.docs.filter(d => !d.lh); LH.idx = lhIndex(LH.base); }
}
async function lhDb() {
  if (LH.db !== undefined) return LH.db;
  try { LH.db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null; } catch (e) { LH.db = null; }
  return LH.db;
}
function lhNeed(id) { LH.pending.add(id); LH.queue.add(id); if (!LH.timer) LH.timer = setTimeout(lhFlush, 25); }
async function lhFlush() {
  LH.timer = null; const ids = [...LH.queue]; LH.queue.clear(); if (!ids.length) return;
  const db = await lhDb(); let got = new Map();
  if (db) {
    try {
      const col = db.collection('mkthist');
      if (typeof col.getMany === 'function') got = await col.getMany(ids);
      else await Promise.all(ids.map(async id => { const s = await col.doc(id).get(); if (s && s.exists) got.set(id, s.data()); }));
    } catch (e) { LH.fails++; console.error(e); if (LH.fails < 3) { ids.forEach(id => LH.pending.delete(id)); return; } }
  }
  // Missing or failed ids are marked loaded too, so they are not requested again.
  ids.forEach(id => { LH.loaded.set(id, (got.get(id) || {}).parts || {}); LH.pending.delete(id); });
  if (![...got.values()].some(x => x && x.parts && Object.keys(x.parts).length)) return;
  liveBuild(LH.base);
  DL.clear(); if (typeof FUND !== 'undefined') FUND.clear(); if (typeof CAL_ALL !== 'undefined') CAL_ALL = null;
  lhRender();
}
/** Re-render once things settle; waits while a dialog is open or the user is typing. */
function lhRender() {
  clearTimeout(LH.renderT);
  LH.renderT = setTimeout(() => {
    const busy = document.querySelector('.modal, .ovl.open') || (document.activeElement && document.activeElement.matches('input, textarea, select'));
    if (busy) { if (++LH.renderTries < 30) lhRender(); return; }
    LH.renderTries = 0;
    if (typeof state !== 'undefined' && state.r && document.querySelector('#main .page')) { try { render(); } catch (e) { console.error(e); } }
  }, 120);
}
if (typeof DL !== 'undefined') {
  const _get = DL.get.bind(DL);
  DL.get = id => { if (LH.idx && LH.idx[id] && !LH.loaded.has(id) && !LH.pending.has(id)) lhNeed(id); return _get(id); };
}
