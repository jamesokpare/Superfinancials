/* =====================================================================
   Superfinancials — SEC filings on U.S. equity pages
   Next.js port add-on, loaded after earnings.js (src/components/LegacyApp.tsx).
   Shows the company's recent SEC EDGAR filings (annual and quarterly reports,
   8-Ks with their items, proxies, registrations) and its latest earnings press
   release, from filings/<id> (written by src/lib/filings/sync.ts). Each
   company's document is read the first time its page opens.
   Outside the U.S. (src/lib/filings/intl.ts): EDINET (Japan), OpenDART
   (Korea) and filings.xbrl.org (EU/UK ESEF reports). Data-desk equities
   matched to a filer show their filings on the same panel, and the Country
   data hub shows each country's latest filings (filings/latest-<CC>), with
   the source credited.
   ===================================================================== */
'use strict';
const FL = { docs: new Map(), pending: new Set(), db: undefined, all: false };
async function flDb() { if (FL.db !== undefined) return FL.db; try { FL.db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null; } catch (e) { FL.db = null; } return FL.db; }
async function flLoad(id) {
  if (FL.docs.has(id) || FL.pending.has(id)) return; FL.pending.add(id);
  const db = await flDb(); let d = null;
  if (db) { try { const s = await db.collection('filings').doc(id).get(); d = s && s.exists ? s.data() : null; } catch (e) { d = null; } }
  FL.docs.set(id, d); FL.pending.delete(id);
  const el = document.getElementById('flBody'); if (el && state.ctx === id) el.innerHTML = flBody(id);
}
function flBody(id) {
  if (!FL.docs.has(id)) return '<p class="note">Loading filings…</p>';
  const d = FL.docs.get(id); if (d && d.src) return flIntlBody(d, false);
  if (!d || !Array.isArray(d.items) || !d.items.length) return `<div class="empty">No ${flUS(id) ? 'SEC ' : ''}filings loaded yet for this company. The filings sync runs every morning.</div>`;
  const rows = FL.all ? d.items : d.items.slice(0, 10); const earn = d.items.find(f => f.earn);
  const lnk2 = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : '';
  return `${earn ? `<div class="callout fd-ok" style="margin-bottom:10px">Latest earnings release: <b>${fd(Date.parse(earn.date))}</b>${earn.period ? ` (period ended ${fd(Date.parse(earn.period))})` : ''} · ${earn.ex ? lnk2(earn.ex, 'Press release') + ' · ' : ''}${lnk2(earn.url, '8-K')}</div>` : ''}
    <div class="tw"><table class="t dense"><thead><tr><th>Filed</th><th>Form</th><th>Description</th><th>Period</th><th>Documents</th></tr></thead><tbody>${rows.map(f => `<tr><td class="sub">${fd(Date.parse(f.date))}</td><td class="mono"><b>${esc(f.form)}</b></td><td>${esc(f.desc)}${f.earn ? ' <span class="badge live">Earnings</span>' : ''}</td><td class="sub">${f.period ? fd(Date.parse(f.period)) : '—'}</td><td>${lnk2(f.url, 'Document')}${f.ex ? ' · ' + lnk2(f.ex, 'Press release') : ''} · ${lnk2(f.index, 'All files')}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">${d.items.length} filings from the last two years · ${esc(d.name || '')} (CIK ${esc(String(d.cik || ''))}) · Source: SEC EDGAR, public domain · checked ${fd(Date.parse(d.checked))}. ${d.items.length > 10 ? `<a href="#" data-flall>${FL.all ? 'Show fewer' : 'Show all'}</a> · ` : ''}<a href="https://www.sec.gov/edgar/browse/?CIK=${esc(String(d.cik || ''))}" target="_blank" rel="noopener noreferrer">Full filing history on EDGAR</a></p>`;
}
const flUS = id => { const o = BY[id]; return /^EQ\./.test(id) && (!o || !o.country || o.country === 'US'); };
const flLnk = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : '';
/** Filings from EDINET, OpenDART or filings.xbrl.org: one company's (filings/<id>) or a country's latest (filings/latest-<CC>). */
function flIntlBody(d, list) {
  const items = Array.isArray(d.items) ? d.items : []; if (!items.length) return '<div class="empty">No filings in the last 60 days.</div>';
  const rows = FL.all ? items : items.slice(0, list ? 15 : 10);
  return `<div class="tw"><table class="t dense"><thead><tr><th>Filed</th>${list ? '<th>Company</th>' : ''}<th>Report</th><th>Period</th><th>Documents</th></tr></thead><tbody>${rows.map(f => `<tr><td class="sub">${fd(Date.parse(f.date))}</td>${list ? `<td>${esc(f.co || '—')}${f.tk ? ` <span class="sub mono">${esc(f.tk)}</span>` : ''}${d.id === 'latest-EU' && f.cc ? ` <span class="sub">${esc(f.cc)}</span>` : ''}</td>` : ''}<td>${esc(f.desc)}${f.orig && f.orig !== f.desc ? `<div class="sub">${esc(f.orig)}</div>` : ''}</td><td class="sub">${f.period ? esc(f.period) : '—'}</td><td>${flLnk(f.url, 'View')}${f.index && f.index !== f.url ? ' · ' + flLnk(f.index, 'Report package') : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">${items.length} filings from the last 60 days · ${esc(d.credit || d.src)} · checked ${fd(Date.parse(d.checked))}. ${items.length > rows.length || FL.all ? `<a href="#" data-flall>${FL.all ? 'Show fewer' : 'Show all'}</a> · ` : ''}${flLnk(d.srcUrl, 'Search all filings at the source')}</p>`;
}
if (typeof PAGES !== 'undefined' && PAGES.sec) {
  const _s = PAGES.sec;
  PAGES.sec = (pg, id) => {
    _s(pg, id);
    try {
      const sid = state.ctx; const o = BY[sid]; if (!o || o.type !== 'equity') return;
      const us = flUS(sid); if (!us && !(typeof ADM !== 'undefined' && ADM.I && ADM.I[sid])) return; // non-U.S.: data-desk equities, matched by the filings sync
      const anchor = pg.querySelector('#cnIntra') || pg.querySelector('.phd'); if (!anchor) return;
      anchor.insertAdjacentHTML('afterend', `<section class="panel" id="flPanel"><header class="ph"><span class="pt">${us ? 'SEC filings' : 'Company filings'}</span><span class="pm"><span class="badge live">REAL</span> ${us ? 'EDGAR' : 'official filing systems'}</span></header><div class="pb" id="flBody">${flBody(sid)}</div></section>`);
      on(pg, 'click', '[data-flall]', e => { e.preventDefault(); FL.all = !FL.all; const el = document.getElementById('flBody'); if (el) el.innerHTML = flBody(sid); });
      flLoad(sid);
    } catch (e) { console.error(e); }
  };
}

/* ---------- Country data hub: the country's latest company filings ---------- */
const FL_CC = new Set('JP KR UK DE FR IT ES NL BE AT IE PT FI DK SE NO PL GR LU CZ HU RO EU'.split(' '));
const FL_SRC = { JP: 'EDINET', KR: 'OpenDART' };
if (typeof PAGES !== 'undefined' && PAGES.cdata) {
  const _c = PAGES.cdata;
  PAGES.cdata = (pg, p) => {
    _c(pg, p);
    try {
      const cc = typeof CDH !== 'undefined' ? CDH.cc : null; if (!cc || !FL_CC.has(cc)) return;
      const grid = pg.querySelector('.grid'); if (!grid) return; const id = 'latest-' + cc;
      const body = () => FL.docs.has(id) ? (FL.docs.get(id) ? flIntlBody(FL.docs.get(id), true) : '<div class="empty">No filings loaded yet for this country. The international filings sync runs every morning.</div>') : '<p class="note">Loading filings…</p>';
      grid.insertAdjacentHTML('beforeend', `<section class="panel c12" id="flCty"><header class="ph"><span class="pt">Latest company filings · ${esc(typeof ddCN === 'function' ? ddCN(cc) : cc)}</span><span class="pm"><span class="badge live">REAL</span> ${FL_SRC[cc] || 'ESEF · filings.xbrl.org'}</span></header><div class="pb" id="flCtyB">${body()}</div></section>`);
      on(pg, 'click', '#flCty [data-flall]', e => { e.preventDefault(); FL.all = !FL.all; const b = document.getElementById('flCtyB'); if (b) b.innerHTML = body(); });
      if (!FL.docs.has(id)) flLoad(id).then(() => { const b = document.getElementById('flCtyB'); if (b && CDH.cc === cc) b.innerHTML = body(); });
    } catch (e) { console.error(e); }
  };
}
