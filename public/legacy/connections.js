/* =====================================================================
   Superfinancials — data connections, sync status and intraday data
   Next.js port add-on, loaded after africa.js (src/components/LegacyApp.tsx).
     Data sources page  the server's data connections from /api/providers
                        (configured or not, what each feeds, a "Test
                        connections" button) and the last run of each
                        scheduled sync (the _meta doc each one writes),
                        in place of the artifact's "not reachable" cards
     Landing › Data     the same connection list, public (no key details)
     Security pages     a delayed quote and the latest session's 5-minute
                        bars from EODHD, loaded on request (/api/intraday/<id>)
   ===================================================================== */
'use strict';
var SF_CONN = null; // public connection list, read by the landing page (superfinancials.js lpData)
const CN = { list: null, checks: null, checking: false, err: null, syncs: null, intra: {} };
const CN_SYNCS = [['mkt', 'Market prices', 'Weekdays 22:30 UTC', 80], ['mktnews', 'News', '06:15 and 16:45 UTC', 26], ['fund', 'Fundamentals and earnings', 'Daily 05:40 UTC', 26], ['macrosync', 'Macro data, calendars, Form D', 'Daily 05:20 and 05:50 UTC', 50], ['afr', 'African markets, Nigerian rates and bond auctions', 'Daily 17:10 UTC', 50], ['filings', 'SEC filings', 'Daily 06:25 UTC', 50], ['filings', 'Japan, Korea, EU and UK filings', 'Daily 06:35 UTC', 50, '_intl'], ['secsync', 'SEC XBRL EPS/revenue, Reg CF and Reg A', 'Daily 07:35 UTC', 50], ['pensionsync', 'Public pension fund reports', 'Mondays 04:35 UTC', 240]];
const cnAgo = iso => { const t = Date.parse(iso || ''); if (!isFinite(t)) return '—'; const h = (Date.now() - t) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
async function cnFetch(path, auth) {
  const f = auth && window.sfAuth && typeof window.sfAuth.fetch === 'function' ? window.sfAuth.fetch.bind(window.sfAuth) : fetch;
  let r; try { r = await f(path); } catch (e) { throw { code: 'network', message: 'Could not reach the server' }; }
  let b = null; try { b = await r.json(); } catch (e) { }
  if (!r.ok) throw { code: (b && b.code) || 'error', message: (b && b.message) || `Request failed (${r.status})` };
  return b;
}
const cnRefresh = () => { if (document.querySelector('#main .page') && !document.querySelector('.modal, .ovl.open') && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) { try { render(); } catch (e) { console.error(e); } } };

/* ---------- connection list (signed in: with env names; signed out: public list) ---------- */
async function cnLoad() {
  try {
    let b; try { b = await cnFetch('/api/providers', true); } catch (e) { if (e.code !== 'not_granted') throw e; b = await cnFetch('/api/providers', false); }
    CN.list = b.connections || []; CN.err = null;
    SF_CONN = CN.list.filter(c => c.kind !== 'database').map(c => ({ name: c.name, uses: c.uses, configured: c.configured }));
  } catch (e) { CN.err = e; }
  if (typeof lpSub === 'function' && typeof showLanding === 'function' && document.querySelector('.vx-src') && lpSub() === 'data') { try { showLanding('data'); } catch (e) { console.error(e); } }
  if (state.r === 'data') cnRefresh();
}
async function cnSyncs() {
  try {
    const db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null; if (!db) return;
    const rows = await Promise.all(CN_SYNCS.map(async ([col, , , , doc]) => { try { const s = await db.collection(col).doc(doc || '_meta').get(); return s && s.exists ? s.data() : null; } catch (e) { return null; } }));
    CN.syncs = rows; if (state.r === 'data') cnRefresh();
  } catch (e) { }
}
function cnPanel() {
  const list = CN.list; const ck = CN.checks ? Object.fromEntries(CN.checks.map(c => [c.id, c])) : {};
  const body = !list ? `<div class="empty">${CN.err ? esc(CN.err.message) : 'Loading the server\'s data connections…'}</div>` :
    `<div class="tw"><table class="t dense"><thead><tr><th>Connection</th><th>What it feeds</th><th>Status</th>${CN.checks ? '<th>Test</th>' : ''}</tr></thead><tbody>${list.map(c => { const k = ck[c.id]; return `<tr><td><b>${esc(c.name)}</b>${c.env ? `<div class="sub mono">${esc(c.env)}</div>` : ''}</td><td class="sub">${esc(c.uses || '')}</td><td>${c.configured ? '<span class="badge ok">Connected</span>' : '<span class="badge">Not set up</span>'}</td>${CN.checks ? `<td>${!c.configured ? '<span class="sub">—</span>' : !k ? '' : k.ok ? `<span class="up">✓ ${nf(k.ms, 0)} ms</span>` : `<span class="dn" title="${esc(k.error || '')}">✕ ${esc((k.error || 'failed').slice(0, 90))}</span>`}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`;
  const n = list ? list.filter(c => c.configured).length : 0;
  return `<section class="panel"><header class="ph"><span class="pt">Data connections</span><span class="pm">${list ? `${n} of ${list.length} set up on this server` : ''} ${list && list[0] && list[0].env ? `<button class="btn sm" id="cnTest" ${CN.checking ? 'disabled' : ''}>${CN.checking ? 'Testing…' : 'Test connections'}</button>` : ''}</span></header>${body}<p class="note" style="padding:0 20px">Keys live only on the server (environment variables); the browser never sees them. A test makes one small request to each connected provider.</p></section>`;
}
function cnSyncPanel() {
  if (!CN.syncs) return '';
  return `<section class="panel"><header class="ph"><span class="pt">Scheduled syncs</span><span class="pm">last run of each job</span></header><div class="tw"><table class="t dense"><thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Summary</th></tr></thead><tbody>${CN_SYNCS.map(([col, name, when, maxH], i) => { const m = CN.syncs[i]; const t = m && Date.parse(m.checked); const stale = !t || (Date.now() - t) / 36e5 > maxH; return `<tr><td><b>${esc(name)}</b></td><td class="sub">${esc(when)}</td><td>${m ? `<span class="badge ${stale ? 'sim' : 'ok'}">${esc(cnAgo(m.checked))}</span>` : '<span class="badge">Never</span>'}</td><td class="sub" style="max-width:520px">${esc(m && m.note ? String(m.note).slice(0, 280) : 'Has not run yet.')}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}
if (typeof PAGES !== 'undefined' && PAGES.data) {
  const _d = PAGES.data;
  PAGES.data = (pg, p) => {
    _d(pg, p);
    try {
      // The artifact's cards for outside APIs ("not reachable here") no longer apply: the server holds the keys.
      const ext = new Set((typeof EXT_SOURCES !== 'undefined' ? EXT_SOURCES : []).map(x => x[0]));
      $$('.srccard', pg).forEach(c => { const h = c.querySelector('h3'); if (h && ext.has(h.textContent)) c.remove(); });
      const sim = $$('.srccard', pg)[0]; const html = cnPanel() + cnSyncPanel();
      if (sim) sim.insertAdjacentHTML('beforebegin', html); else pg.insertAdjacentHTML('beforeend', html);
      const b = $('#cnTest', pg); if (b) b.onclick = async () => { CN.checking = true; render(); try { const r = await cnFetch('/api/providers?check=1', true); CN.checks = r.connections || []; } catch (e) { toast(e.message || 'Test failed', true); } CN.checking = false; render(); };
      if (!CN.list && !CN.err) cnLoad(); if (!CN.syncs) cnSyncs();
    } catch (e) { console.error(e); }
  };
}

/* ---------- security page: intraday quote and bars ---------- */
const CN_INTRA = new Set(['equity', 'etf', 'index', 'fx', 'crypto', 'commodity']);
function cnIntraChart(bars, o) {
  if (!bars || bars.length < 2) return '<div class="empty">No intraday bars for the latest session.</div>';
  const W = 760, H = 180, P = 28; const xs = bars.map(b => b[0]), ys = bars.map(b => b[4]);
  const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1, lo = Math.min(...bars.map(b => b[3] || b[4])), hi = Math.max(...bars.map(b => b[2] || b[4])), r = hi - lo || 1;
  const X = t => P + (t - x0) / (x1 - x0 || 1) * (W - 2 * P), Y = v => H - P - (v - lo) / r * (H - 2 * P);
  const up = ys[ys.length - 1] >= ys[0]; const col = up ? 'var(--up, #1a7f37)' : 'var(--dn, #c0392b)';
  const path = bars.map((b, i) => `${i ? 'L' : 'M'}${X(b[0]).toFixed(1)},${Y(b[4]).toFixed(1)}`).join('');
  const tm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Intraday price"><path d="${path}" fill="none" stroke="${col}" stroke-width="1.6"/><text x="${P}" y="${H - 8}" font-size="10" fill="currentColor" opacity=".6">${tm(x0)} UTC</text><text x="${W - P}" y="${H - 8}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${tm(x1)} UTC</text><text x="${W - 4}" y="${Y(hi) + 4}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${fv(o, hi)}</text><text x="${W - 4}" y="${Y(lo)}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${fv(o, lo)}</text></svg>`;
}
function cnIntraBody(id) {
  const o = BY[id]; const s = CN.intra[id];
  if (!s) return `<button class="btn sm" data-cnintra="${esc(id)}">Load intraday chart and delayed quote</button> <span class="sub">Uses one EODHD request; refreshed at most once a minute.</span>`;
  if (s.loading) return '<div class="empty">Loading…</div>';
  if (s.err) return `<div class="callout">${esc(s.err.message || 'Could not load intraday data')}${s.err.code === 'not_configured' ? ' Set EODHD_API_KEY on the server to enable it.' : ''}</div>`;
  const v = s.v; const q = v.quote;
  const kpi = q ? `<div class="fi-kpis">${[['Last (delayed)', fv(o, q.c), q.chp == null ? '' : `<small class="${cls(q.chp)}">${pc(q.chp)}</small>`], ['Open', fv(o, q.o), ''], ['High', fv(o, q.h), ''], ['Low', fv(o, q.l), ''], ['Previous close', fv(o, q.prev), ''], ['Volume', q.vol ? nf(q.vol, 0) : '—', '']].map(([k, a, b]) => `<div><span>${k}</span><b>${a}</b>${b}</div>`).join('')}</div>` : '';
  return `${kpi}${cnIntraChart(v.bars, o)}<p class="note">${v.bars.length} ${v.interval} bars${v.session ? ` for ${fd(Date.parse(v.session))}` : ''} · ${esc(v.sym)} · ${esc(v.note)} ${q ? `Quote time ${new Date(q.t).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC.` : ''} <a href="#" data-cnintra="${esc(id)}" data-reload="1">Refresh</a></p>`;
}
if (typeof PAGES !== 'undefined' && PAGES.sec) {
  const _s = PAGES.sec;
  PAGES.sec = (pg, id) => {
    _s(pg, id);
    try {
      const sid = state.ctx; const o = BY[sid]; if (!o || !CN_INTRA.has(o.type) || /^(AD|PV)\./.test(sid)) return;
      const h = pg.querySelector('.phd'); if (!h) return;
      h.insertAdjacentHTML('afterend', `<section class="panel" id="cnIntra"><header class="ph"><span class="pt">Intraday · latest session</span><span class="pm"><span class="badge live">REAL</span> EODHD · delayed</span></header><div class="pb" id="cnIntraB">${cnIntraBody(sid)}</div></section>`);
      on(pg, 'click', '[data-cnintra]', async (e, b) => {
        e.preventDefault(); const k = b.dataset.cnintra; CN.intra[k] = { loading: true }; const el = document.getElementById('cnIntraB'); if (el) el.innerHTML = cnIntraBody(k);
        try { CN.intra[k] = { v: await cnFetch('/api/intraday/' + encodeURIComponent(k) + '?interval=5m', true) }; } catch (err) { CN.intra[k] = { err }; }
        const el2 = document.getElementById('cnIntraB'); if (el2 && state.ctx === k) el2.innerHTML = cnIntraBody(k);
      });
    } catch (e) { console.error(e); }
  };
}

setTimeout(cnLoad, 0);
