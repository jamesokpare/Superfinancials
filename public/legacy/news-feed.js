/* =====================================================================
   Superfinancials — headlines from the connected news providers
   Next.js port add-on, loaded right after superfinancials.js
   (src/components/LegacyApp.tsx). Reads the `mktnews` collection written by
   the server's news sync (src/lib/news/sync.ts: Marketaux, NewsAPI.ai,
   Currents) and adds:
     · "Latest headlines" at the top of Market news
     · "Reported that day" headlines on generated briefs about a company
     · company headlines on each security page's News tab and the overview panel
   With no headlines stored, every page renders exactly as before.
   ===================================================================== */
'use strict';
const NF = { items: [], meta: null, st: 'idle', sig: '', f: { via: '', rel: '', q: '' }, shown: 12 };
const NF_LS = 'sf.news.v1';
const NF_VIA = { marketaux: 'Marketaux', newsapi: 'NewsAPI.ai', currents: 'Currents', official: 'Official sources', deals: 'Startup and deal news' };

function nfBuild(docs) {
  let items = [], meta = null;
  for (const { x } of docs) {
    if (!x || typeof x !== 'object') continue;
    if (x.type === 'meta') meta = x;
    else if (x.type === 'news-day' && Array.isArray(x.items)) items.push(...x.items);
  }
  const seen = new Set();
  NF.items = items
    .filter(i => i && i.id && i.title && /^https?:\/\//.test(String(i.url)) && isFinite(Date.parse(i.t)) && !seen.has(i.id) && seen.add(i.id))
    .map(i => ({ ...i, at: Date.parse(i.t), tk: Array.isArray(i.tk) ? i.tk.map(String) : [], cc: Array.isArray(i.cc) ? i.cc : [], sent: typeof i.sent === 'number' ? i.sent : null }))
    .sort((a, b) => b.at - a.at);
  NF.meta = meta; NF.ids = null;
}

/* ---------- which instruments a headline is about ----------
   Provider ticker tags first; then company names, "$TICKER" and "(NYSE: TICKER)" in the title. */
const NF_ALIAS = { AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia|NVIDIA', AVGO: 'Broadcom', ORCL: 'Oracle', ADBE: 'Adobe', CRM: 'Salesforce', AMD: 'AMD', INTC: 'Intel', GOOGL: 'Alphabet|Google', META: 'Meta Platforms|Meta', NFLX: 'Netflix', DIS: 'Disney', T: 'AT&T', VZ: 'Verizon', AMZN: 'Amazon', TSLA: 'Tesla', HD: 'Home Depot', MCD: "McDonald's", NKE: 'Nike', WMT: 'Walmart', COST: 'Costco', PG: 'Procter & Gamble|P&G', KO: 'Coca-Cola', PEP: 'PepsiCo', JPM: 'JPMorgan', BAC: 'Bank of America', GS: 'Goldman Sachs', MS: 'Morgan Stanley', V: 'Visa', UNH: 'UnitedHealth', LLY: 'Eli Lilly', JNJ: 'Johnson & Johnson', MRK: 'Merck', PFE: 'Pfizer', ABBV: 'AbbVie', XOM: 'Exxon', CVX: 'Chevron', CAT: 'Caterpillar', BA: 'Boeing', GE: 'GE Aerospace', NEE: 'NextEra', DUK: 'Duke Energy', LIN: 'Linde', SHW: 'Sherwin-Williams', PLD: 'Prologis', AMT: 'American Tower', FCX: 'Freeport-McMoRan', SCCO: 'Southern Copper', NEM: 'Newmont', AA: 'Alcoa', ALB: 'Albemarle', NUE: 'Nucor', MOS: 'Mosaic', CF: 'CF Industries', COP: 'ConocoPhillips', OXY: 'Occidental', VLO: 'Valero', SLB: 'Schlumberger|SLB', CCJ: 'Cameco', ADM: 'Archer-Daniels-Midland|ADM', BG: 'Bunge', DE: 'Deere', HSY: 'Hershey' };
const nfRxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function nfMatchers() {
  if (NF.rx && NF.rxN === U.length) return NF.rx;
  const SUF = /\b(Inc|Corp|Corporation|Company|Co|Plc|PLC|Ltd|Limited|Holdings?|Group|Class [A-C]|Nigeria|Incorporated)\b\.?/g;
  NF.rx = U.filter(o => o.type === 'equity' && o.tk).map(o => {
    const names = NF_ALIAS[o.tk] && o.id === 'EQ.' + o.tk ? NF_ALIAS[o.tk].split('|') : [String(o.name || '').replace(/\(.*?\)/g, '').replace(SUF, '').replace(/[,\s]+$/g, '').replace(/\s+/g, ' ').trim()];
    const alts = names.filter(n => n.length >= 3).map(nfRxEsc);
    const tk = nfRxEsc(o.tk);
    return { id: o.id, rx: new RegExp(`(?:^|[^\\w&])(?:${[...alts, `\\$${tk}`].join('|')})(?![\\w&])|\\((?:NYSE|NASDAQ|Nasdaq|NGX|JSE|LSE)\\s*:\\s*${tk}\\)`) };
  });
  NF.rxN = U.length; return NF.rx;
}
function nfIds(i) {
  const rx = nfMatchers();
  if (!NF.ids || NF.idsN !== U.length) { NF.ids = new Map(); NF.idsN = U.length; }
  if (NF.ids.has(i.id)) return NF.ids.get(i.id);
  const out = new Set();
  for (const s of i.tk) for (const id of ['EQ.' + s, 'ET.' + s, 'AD.NG.' + s]) if (BY[id]) out.add(id);
  for (const m of rx) if (m.rx.test(i.title)) out.add(m.id);
  const r = [...out]; NF.ids.set(i.id, r); return r;
}
/** Headlines about `id` published around session `t` (from 6 h before to 30 h after midnight UTC). */
const nfFor = (id, t) => NF.items.filter(i => i.at >= t - 6 * 36e5 && i.at < t + 30 * 36e5 && nfIds(i).includes(id));

/* ---------- rendering ---------- */
function nfAgo(t) { const m = (Date.now() - t) / 6e4; if (m < 1) return 'now'; if (m < 60) return Math.round(m) + 'm'; if (m < 1440) return Math.round(m / 60) + 'h'; return fd(t, { day: '2-digit', month: 'short' }); }
function nfSent(v) {
  if (v == null || !isFinite(v)) return '';
  const k = v >= .15 ? 'pos' : v <= -.15 ? 'neg' : 'neu';
  return `<span class="nf-s ${k}" title="Sentiment score from the news provider: ${v.toFixed(2)} on a scale of −1 to +1">${{ pos: 'Positive', neg: 'Negative', neu: 'Neutral' }[k]}</span>`;
}
function nfRow(i, compact) {
  const ids = nfIds(i);
  return `<li><time title="${esc(fdt(i.at))}">${nfAgo(i.at)}</time><div><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer nofollow"><b>${esc(i.title)}</b></a>${!compact && i.sum ? `<p>${esc(i.sum)}</p>` : ''}<span class="nf-meta"><span>${esc(i.src || '')}</span><span>via ${esc(NF_VIA[i.via] || i.via || '')}</span>${ids.slice(0, 4).map(id => lnk(id)).join('')}${nfSent(i.sent)}</span></div></li>`;
}
function nfFiltered() {
  const { via, rel, q } = NF.f; const R = rel && typeof relSets === 'function' ? relSets()[rel] : null; const s = q.trim().toLowerCase();
  return NF.items.filter(i => (!via || i.via === via) && (!R || nfIds(i).some(id => R.has(id))) && (!s || (i.title + ' ' + (i.sum || '') + ' ' + (i.src || '')).toLowerCase().includes(s)));
}
function nfList(sec) {
  const all = nfFiltered(); const shown = all.slice(0, NF.shown);
  $('.nf-list', sec).innerHTML = shown.length ? `<ul class="rl-news">${shown.map(i => nfRow(i)).join('')}</ul>${all.length > shown.length ? `<button class="btn sm ghost nf-more" data-nfmore>Show more (${all.length - shown.length})</button>` : ''}` : '<p class="note" style="padding:12px 20px">No headlines match these filters.</p>';
  $('.nf-n', sec).textContent = `${all.length} of ${NF.items.length}`;
}
function nfMount(sec) {
  const vias = [...new Set(NF.items.map(i => i.via))].filter(v => NF_VIA[v]);
  const chip = (attr, v, l, on) => `<button class="chip ${on ? 'on' : ''}" ${attr}="${esc(v)}">${esc(l)}</button>`;
  const upd = NF.meta && Date.parse(NF.meta.checked);
  sec.innerHTML = `<header class="ph"><span class="pt">Latest headlines</span><span class="pm"><span class="badge ok">LIVE NEWS</span> <span class="nf-n"></span>${upd ? ` · updated ${esc(fdt(upd))}` : ''}</span></header>
    <div class="nf-tb">${chip('data-nfv', '', 'All sources', !NF.f.via)}${vias.map(v => chip('data-nfv', v, NF_VIA[v], NF.f.via === v)).join('')}<span class="nf-sep"></span>${chip('data-nfr', 'w', 'My watchlist', NF.f.rel === 'w')}${chip('data-nfr', 'p', 'My portfolio', NF.f.rel === 'p')}<input class="inp sm nf-q" type="search" placeholder="Search headlines" aria-label="Search headlines" value="${esc(NF.f.q)}"></div>
    <div class="nf-list"></div>
    <div class="pf"><span>Headlines and summaries belong to their publishers; links open the original article. Company tags and sentiment come from the providers or from matching company names in the headline.</span><span>Sources: ${vias.map(v => esc(NF_VIA[v])).join(', ')}</span></div>`;
  nfList(sec);
  on(sec, 'click', '[data-nfv]', (e, b) => { NF.f.via = b.dataset.nfv; NF.shown = 12; $$('[data-nfv]', sec).forEach(x => x.classList.toggle('on', x === b)); nfList(sec); });
  on(sec, 'click', '[data-nfr]', (e, b) => { NF.f.rel = NF.f.rel === b.dataset.nfr ? '' : b.dataset.nfr; NF.shown = 12; $$('[data-nfr]', sec).forEach(x => x.classList.toggle('on', x.dataset.nfr === NF.f.rel)); nfList(sec); });
  on(sec, 'click', '[data-nfmore]', () => { NF.shown += 20; nfList(sec); });
  $('.nf-q', sec).addEventListener('input', e => { NF.f.q = e.target.value; NF.shown = 12; nfList(sec); });
}
function nfDecorate(pg) {
  if (!NF.items.length) return;
  const sub = $('.phd p', pg);
  if (sub) sub.innerHTML = sub.innerHTML.replace('with no news provider connected, causes are always marked unconfirmed.', 'headlines from the connected news providers are listed first. A brief\'s cause stays unconfirmed; where a headline about the same company appeared that day, it is shown with the brief.');
  $$('.pf', pg).forEach(f => { f.innerHTML = f.innerHTML.replace('Original-article, filing and earnings-release links appear when licensed providers are connected in Data Sources.', 'Original-article links come from the connected news providers (Latest headlines); filings and earnings releases are not connected yet.'); });
  const h = $('.phd', pg); if (!h) return;
  const sec = document.createElement('section'); sec.className = 'panel nf-panel'; nfMount(sec); h.after(sec);
}

/* ---------- hooks into the app ---------- */
if (typeof PAGES !== 'undefined' && PAGES.news) { const _pn = PAGES.news; PAGES.news = (pg, p) => { _pn(pg, p); try { nfDecorate(pg); } catch (e) { console.error(e); } }; }
if (typeof nxCard === 'function') {
  const _card = nxCard;
  nxCard = function (x) {
    let html = _card(x);
    try {
      if (x && x.p && x.kind !== 'ins' && NF.items.length) {
        const hs = nfFor(x.p, x.day);
        if (hs.length) html = html.replace('</div>', `</div><div class="nf-cat"><span class="nx-lab">Reported that day</span>${hs.slice(0, 2).map(i => `<div><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(i.title)}</a> <span class="muted">${esc(i.src || '')}</span></div>`).join('')}<p class="note">Headlines about the same company. They may explain the move, but the cause is not confirmed.</p></div>`);
      }
    } catch (e) { console.error(e); }
    return html;
  };
}
if (typeof newsList === 'function') {
  const _nl = newsList;
  newsList = function (el, o = {}) {
    _nl(el, o);
    try {
      if (!NF.items.length) return;
      const hs = o.ticker ? NF.items.filter(i => nfIds(i).includes(o.ticker)).slice(0, 10) : o.compact ? NF.items.slice(0, 3) : [];
      if (!hs.length) return;
      el.insertAdjacentHTML('afterbegin', `<div class="nf-in"><div class="nf-h">${o.ticker ? 'Headlines' : 'Latest headlines'} <span class="badge ok">LIVE NEWS</span></div><ul class="rl-news nf-tight">${hs.map(i => nfRow(i, o.compact)).join('')}</ul></div>`);
    } catch (e) { console.error(e); }
  };
}

/* ---------- loading: cached copy first, then the live database ---------- */
function nfRefresh() {
  if (typeof state !== 'undefined' && ['news', 'sec', 'overview'].includes(state.r) && document.querySelector('#main .page') && !document.querySelector('.modal, .ovl.open') && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) { try { render(); } catch (e) { console.error(e); } }
}
try { const c = JSON.parse(localStorage.getItem(NF_LS) || 'null'); if (c && Array.isArray(c.docs)) { nfBuild(c.docs); NF.sig = c.sig || ''; NF.st = 'cached'; } } catch (e) { }
async function nfConnect() {
  try {
    const db = window.claude && typeof window.claude.use === 'function' ? await withTimeout(window.claude.use('db'), 10000) : null;
    if (!db) { if (NF.st !== 'cached') NF.st = 'off'; return; }
    db.collection('mktnews').onSnapshot(snap => {
      const docs = snap.docs.filter(d => d.exists !== false).map(d => ({ id: d.id, x: d.data() }));
      const sig = docs.map(d => d.id + ':' + (d.x?.checked || '')).sort().join('|');
      NF.st = 'on'; if (sig === NF.sig) return; NF.sig = sig; nfBuild(docs);
      // Cache only the newest headlines; the full set can be larger than localStorage allows.
      try { localStorage.setItem(NF_LS, JSON.stringify({ sig, docs: [{ id: 'cache', x: { type: 'news-day', items: NF.items.slice(0, 80).map(({ at, ...i }) => i) } }, ...(NF.meta ? [{ id: '_meta', x: NF.meta }] : [])] })); } catch (e) { }
      nfRefresh();
    }, () => { if (NF.st !== 'cached') NF.st = 'off'; });
  } catch (e) { if (NF.st !== 'cached') NF.st = 'off'; }
}
setTimeout(nfConnect, 0);
