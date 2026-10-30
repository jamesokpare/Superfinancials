/* =====================================================================
   Superfinancials — SEC filings on U.S. equity pages
   Next.js port add-on, loaded after earnings.js (src/components/LegacyApp.tsx).
   Shows the company's recent SEC EDGAR filings (annual and quarterly reports,
   8-Ks with their items, proxies, registrations) and its latest earnings press
   release, from filings/<id> (written by src/lib/filings/sync.ts). Each
   company's document is read the first time its page opens.
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
  const d = FL.docs.get(id); if (!d || !Array.isArray(d.items) || !d.items.length) return '<div class="empty">No SEC filings loaded yet for this company. The filings sync runs every morning.</div>';
  const rows = FL.all ? d.items : d.items.slice(0, 10); const earn = d.items.find(f => f.earn);
  const lnk2 = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : '';
  return `${earn ? `<div class="callout fd-ok" style="margin-bottom:10px">Latest earnings release: <b>${fd(Date.parse(earn.date))}</b>${earn.period ? ` (period ended ${fd(Date.parse(earn.period))})` : ''} · ${earn.ex ? lnk2(earn.ex, 'Press release') + ' · ' : ''}${lnk2(earn.url, '8-K')}</div>` : ''}
    <div class="tw"><table class="t dense"><thead><tr><th>Filed</th><th>Form</th><th>Description</th><th>Period</th><th>Documents</th></tr></thead><tbody>${rows.map(f => `<tr><td class="sub">${fd(Date.parse(f.date))}</td><td class="mono"><b>${esc(f.form)}</b></td><td>${esc(f.desc)}${f.earn ? ' <span class="badge live">Earnings</span>' : ''}</td><td class="sub">${f.period ? fd(Date.parse(f.period)) : '—'}</td><td>${lnk2(f.url, 'Document')}${f.ex ? ' · ' + lnk2(f.ex, 'Press release') : ''} · ${lnk2(f.index, 'All files')}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">${d.items.length} filings from the last two years · ${esc(d.name || '')} (CIK ${esc(String(d.cik || ''))}) · Source: SEC EDGAR, public domain · checked ${fd(Date.parse(d.checked))}. ${d.items.length > 10 ? `<a href="#" data-flall>${FL.all ? 'Show fewer' : 'Show all'}</a> · ` : ''}<a href="https://www.sec.gov/edgar/browse/?CIK=${esc(String(d.cik || ''))}" target="_blank" rel="noopener noreferrer">Full filing history on EDGAR</a></p>`;
}
if (typeof PAGES !== 'undefined' && PAGES.sec) {
  const _s = PAGES.sec;
  PAGES.sec = (pg, id) => {
    _s(pg, id);
    try {
      const sid = state.ctx; const o = BY[sid]; if (!o || o.type !== 'equity' || !/^EQ\./.test(sid)) return;
      const anchor = pg.querySelector('#cnIntra') || pg.querySelector('.phd'); if (!anchor) return;
      anchor.insertAdjacentHTML('afterend', `<section class="panel" id="flPanel"><header class="ph"><span class="pt">SEC filings</span><span class="pm"><span class="badge live">REAL</span> EDGAR</span></header><div class="pb" id="flBody">${flBody(sid)}</div></section>`);
      on(pg, 'click', '[data-flall]', e => { e.preventDefault(); FL.all = !FL.all; const el = document.getElementById('flBody'); if (el) el.innerHTML = flBody(sid); });
      flLoad(sid);
    } catch (e) { console.error(e); }
  };
}
