/* =====================================================================
   Superfinancials — African markets
   Next.js port add-on, loaded after registry.js (src/components/LegacyApp.tsx).
   Shows what the daily African markets sync stores (src/lib/africa/sync.ts):
     Movers        NGX session summary, gainers, decliners, most active,
                   pan-African movers, NGX ETFs, NASD OTC securities and
                   MyStocks market intelligence (afr/ngx)
     Country data  profile, trade and upcoming elections for African
                   countries, read on demand from /api/africa/country/<CC>
   Disclosures, company news, NGX dividends and elections are written as
   data-desk news and events, so Market news, the calendar and security
   pages already show them.
   ===================================================================== */
'use strict';
const AFR = { st: 'idle', ngx: null, meta: null, sig: '', cc: {} };
const AFR_LS = 'sf.afr.v1';
const AFR_CC = new Set('DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(' '));

/* ---------- formatting ---------- */
const afrBig = v => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e12 ? nf(v / 1e12, 2) + 'tn' : Math.abs(v) >= 1e9 ? nf(v / 1e9, 2) + 'bn' : Math.abs(v) >= 1e6 ? nf(v / 1e6, 2) + 'm' : Math.abs(v) >= 1e4 ? nf(v / 1e3, 1) + 'k' : nf(v, 0);
const afrTk = (tk, ex) => { const id = 'AD.NG.' + tk; return !ex && typeof BY !== 'undefined' && BY[id] ? lnk(id, tk) : `<b>${esc(tk || '—')}</b>`; };
const afrAge = iso => { const t = Date.parse(iso || ''); return isFinite(t) ? fd(t, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' UTC' : '—'; };
function afrRows(rows, o = {}) {
  if (!rows || !rows.length) return '<tr><td class="sub">None</td></tr>';
  return rows.map(x => `<tr><td style="max-width:0;width:58%">${afrTk(x.tk, o.ex)}${x.ex && o.ex ? ` <span class="sub">${esc(x.ex)}</span>` : ''}<div class="sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.name || '')}</div></td><td class="r">${x.c == null ? '—' : nf(x.c, 2)}${o.vol ? `<div class="sub">${afrBig(x.vol)} shares</div>` : `<div class="${cls(x.chp)}"><b>${x.chp == null ? '—' : pc(x.chp)}</b></div>`}</td></tr>`).join('');
}
const afrTbl = (title, rows, o = {}) => `<div class="${o.c || 'c4'}"><h6 style="margin:4px 0 6px">${esc(title)}</h6><div class="tw"><table class="t dense"><tbody>${afrRows(rows, o)}</tbody></table></div></div>`;

/* ---------- Movers: NGX panel ---------- */
function afrNgxPanel() {
  const s = AFR.ngx; if (!s) return '';
  const m = s.market || null; const src = s.src || {};
  const kpi = m ? `<div class="fi-kpis">${[
    ['NGX All-Share', m.asi == null ? '—' : nf(m.asi, 2), m.chp == null ? '' : `<small class="${cls(m.chp)}">${pc(m.chp)}</small>`],
    ['Market cap', m.mcap == null ? '—' : '₦' + afrBig(m.mcap), ''], ['Volume', afrBig(m.volume), ''], ['Value', m.value == null ? '—' : '₦' + afrBig(m.value), ''], ['Deals', m.deals == null ? '—' : nf(m.deals, 0), ''],
    ['Breadth', m.adv == null && m.dec == null ? '—' : `${m.adv ?? 0} / ${m.dec ?? 0}${m.unch != null ? ` / ${m.unch}` : ''}`, '<small>up / down / flat</small>'],
  ].map(([k, v, x]) => `<div><span>${k}</span><b>${v}</b>${x}</div>`).join('')}</div>` : '';
  const intel = s.intel && (s.intel.text.length || s.intel.sectors.length) ? `<h6 style="margin:14px 0 6px">Market intelligence <span class="sub">${esc(src.intel || '')}</span></h6>${s.intel.text.map(t => `<p style="margin:0 0 6px">${esc(t)}</p>`).join('')}${s.intel.sectors.length ? `<div class="chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${s.intel.sectors.map(x => `<span class="chip">${esc(x.name)} <b class="${cls(x.chp)}">${pc(x.chp)}</b></span>`).join('')}</div>` : ''}` : '';
  const more = [
    s.pan && s.pan.length ? afrTbl('Pan-African movers', s.pan, { ex: true }) : '',
    s.etfs && s.etfs.length ? afrTbl('NGX exchange-traded funds', s.etfs.slice(0, 8)) : '',
    s.nasd && s.nasd.length ? `<div class="c4"><h6 style="margin:4px 0 6px">NASD OTC securities</h6><details><summary class="sub" style="cursor:pointer">${s.nasd.length} ${s.nasd.length === 1 ? 'security' : 'securities'} · show</summary><div class="tw" style="max-height:320px;overflow:auto"><table class="t dense"><tbody>${afrRows(s.nasd, { ex: true })}</tbody></table></div></details></div>` : '',
  ].filter(Boolean).join('');
  const srcs = [...new Set(Object.values(src).filter(Boolean))].join(', ');
  return `<section class="panel" id="afrNgx"><header class="ph"><span class="pt">Nigerian Exchange (NGX)${m && m.status ? ` · ${esc(m.status)}` : ''}</span><span class="pm"><span class="badge live">REAL</span> updated ${afrAge(s.asOf)}</span></header><div class="pb">${kpi}
    <div class="grid" style="margin-top:10px">${afrTbl('Top gainers', s.gainers)}${afrTbl('Top decliners', s.losers)}${afrTbl('Most active by volume', s.active, { vol: true })}</div>
    ${more ? `<div class="grid" style="margin-top:10px">${more}</div>` : ''}${intel}
    <p class="note">End-of-day figures from ${esc(srcs || 'the connected African market APIs')}, refreshed daily after the NGX close. Corporate disclosures, company news and dividend dates appear in Market news, the calendar and each listing's page.</p></div></section>`;
}
if (typeof PAGES !== 'undefined' && PAGES.movers) {
  const _m = PAGES.movers;
  PAGES.movers = (pg, p) => { _m(pg, p); try { const html = afrNgxPanel(); const h = pg.querySelector('.phd'); if (html && h) h.insertAdjacentHTML('afterend', html); } catch (e) { console.error(e); } };
}

/* ---------- Country data: Africa API profile, trade and elections ---------- */
async function afrCountry(cc) {
  const c = AFR.cc[cc]; if (c && (c.v || c.loading)) return c;
  AFR.cc[cc] = { loading: true };
  try {
    if (!window.sfAuth || typeof window.sfAuth.fetch !== 'function') throw { code: 'offline', message: 'Country profiles need the signed-in version of Superfinancials.' };
    let r; try { r = await window.sfAuth.fetch('/api/africa/country/' + encodeURIComponent(cc)); } catch (e) { throw { code: 'network', message: 'Could not reach the server' }; }
    let b = null; try { b = await r.json(); } catch (e) { }
    if (!r.ok) throw { code: (b && b.code) || 'error', message: (b && b.message) || `Request failed (${r.status})` };
    AFR.cc[cc] = { v: b };
  } catch (e) { AFR.cc[cc] = { err: e }; }
  return AFR.cc[cc];
}
function afrCountryHtml(c) {
  if (!c || c.loading) return '<div class="empty">Loading the country profile…</div>';
  if (c.err) return `<div class="callout" style="margin:12px 20px">${esc(c.err.message || 'Could not load the profile')}${c.err.code === 'not_configured' ? ' Set AFRICA_API_KEY on the server to enable it.' : ''}</div>`;
  const v = c.v; const val = x => typeof x.v === 'number' ? (Math.abs(x.v) >= 1e4 ? afrBig(x.v) : nf(x.v, Number.isInteger(x.v) ? 0 : 2)) : esc(x.v);
  const prof = v.profile.length ? `<dl class="kl">${v.profile.map(f => `<div><dt>${esc(f.label)}</dt><dd>${val(f)}</dd></div>`).join('')}</dl>` : '<div class="empty">No profile figures returned.</div>';
  const trade = v.trade.facts.length || v.trade.lists.length ? `${v.trade.facts.length ? `<dl class="kl">${v.trade.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${val(f)}</dd></div>`).join('')}</dl>` : ''}${v.trade.lists.map(l => `<h6 style="margin:10px 0 6px">${esc(l.title)}</h6><div class="tw"><table class="t dense"><tbody>${l.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${afrBig(r.v)}</td><td class="r sub">${r.share == null ? '' : nf(r.share, 1) + '%'}</td></tr>`).join('')}</tbody></table></div>`).join('')}` : '<div class="empty">No trade figures returned.</div>';
  const el = v.elections.length ? `<ul class="dd-ul">${v.elections.map(e => `<li><b>${fd(Date.parse(e.date))}</b> ${esc(e.type)}</li>`).join('')}</ul>` : '<div class="empty">No upcoming elections listed.</div>';
  return `<div class="grid"><div class="c6"><h6 style="margin:4px 0 6px">Profile</h6>${prof}</div><div class="c6"><h6 style="margin:4px 0 6px">Trade · ${esc(v.trade.years)}</h6>${trade}<h6 style="margin:14px 0 6px">Upcoming elections</h6>${el}</div></div><p class="note">From Africa API, read live (cached for up to six hours) · ${afrAge(v.asOf)}.${v.errors && v.errors.length ? ` Some parts did not load: ${esc(v.errors.join('; '))}.` : ''}</p>`;
}
if (typeof PAGES !== 'undefined' && PAGES.cdata) {
  const _c = PAGES.cdata;
  PAGES.cdata = (pg, p) => {
    _c(pg, p);
    try {
      const cc = typeof CDH !== 'undefined' ? CDH.cc : null; if (!cc || !AFR_CC.has(cc)) return;
      const grid = pg.querySelector('.grid'); if (!grid) return;
      grid.insertAdjacentHTML('beforeend', `<section class="panel c12" id="afrCty"><header class="ph"><span class="pt">Country profile &amp; trade · ${esc(ddCN(cc))}</span><span class="pm"><span class="badge live">REAL</span> Africa API</span></header><div class="pb" id="afrCtyB">${afrCountryHtml(AFR.cc[cc])}</div></section>`);
      if (!AFR.cc[cc] || (!AFR.cc[cc].v && !AFR.cc[cc].loading && !AFR.cc[cc].err)) afrCountry(cc).then(c => { const b = document.getElementById('afrCtyB'); if (b && CDH.cc === cc) b.innerHTML = afrCountryHtml(c); });
    } catch (e) { console.error(e); }
  };
}

/* ---------- loading: cached copy first, then the live database ---------- */
try { const c = JSON.parse(localStorage.getItem(AFR_LS) || 'null'); if (c && c.ngx) { AFR.ngx = c.ngx; AFR.sig = c.sig || ''; AFR.st = 'cached'; } } catch (e) { }
async function afrConnect() {
  try {
    const db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null;
    if (!db) { if (AFR.st !== 'cached') AFR.st = 'off'; return; }
    db.collection('afr').onSnapshot(snap => {
      let ngx = null, meta = null;
      snap.docs.forEach(d => { if (d.exists === false) return; const x = d.data(); if (d.id === 'ngx' && x && x.type === 'ngx') ngx = x; else if (d.id === '_meta') meta = x; });
      AFR.meta = meta; AFR.st = 'on';
      const sig = ngx ? String(ngx.asOf) : ''; if (sig === AFR.sig) return; AFR.sig = sig; AFR.ngx = ngx;
      try { localStorage.setItem(AFR_LS, JSON.stringify({ sig, ngx })); } catch (e) { }
      if (state.r === 'movers' && document.querySelector('#main .page') && !document.querySelector('.modal, .ovl.open') && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) { try { render(); } catch (e) { console.error(e); } }
    }, () => { if (AFR.st !== 'cached') AFR.st = 'off'; });
  } catch (e) { if (AFR.st !== 'cached') AFR.st = 'off'; }
}
setTimeout(afrConnect, 0);
