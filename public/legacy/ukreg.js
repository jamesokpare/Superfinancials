/* =====================================================================
   Superfinancials — UK company register (Companies House)
   Next.js port add-on, loaded after superfinancials.js
   (src/components/LegacyApp.tsx). Adds a "UK company register" page under
   Private markets › Companies & deals: search the official register, then
   open a company's profile, officers, people with significant control,
   filing history and charges. Data is fetched live through the server
   (/api/uk-companies, signed-in users only; the API key stays on the server).
   Data-desk private companies with a company number (chNo) show a register
   panel on their profile; UK desk companies without one get a search link.
   ===================================================================== */
'use strict';
const UK = { q: '', res: null, err: null, busy: false, auto: false, resigned: false };
const UK_FIND = 'https://find-and-update.company-information.service.gov.uk';
/** UK SIC 2007 divisions (first two digits of a SIC code). */
const UK_SIC = { '01': 'Crop and animal production', '02': 'Forestry and logging', '03': 'Fishing and aquaculture', '05': 'Mining of coal and lignite', '06': 'Extraction of crude petroleum and natural gas', '07': 'Mining of metal ores', '08': 'Other mining and quarrying', '09': 'Mining support services', '10': 'Manufacture of food products', '11': 'Manufacture of beverages', '12': 'Manufacture of tobacco products', '13': 'Manufacture of textiles', '14': 'Manufacture of wearing apparel', '15': 'Manufacture of leather products', '16': 'Manufacture of wood products', '17': 'Manufacture of paper products', '18': 'Printing and reproduction of recorded media', '19': 'Manufacture of coke and refined petroleum products', '20': 'Manufacture of chemicals', '21': 'Manufacture of pharmaceutical products', '22': 'Manufacture of rubber and plastic products', '23': 'Manufacture of other non-metallic mineral products', '24': 'Manufacture of basic metals', '25': 'Manufacture of fabricated metal products', '26': 'Manufacture of computer, electronic and optical products', '27': 'Manufacture of electrical equipment', '28': 'Manufacture of machinery and equipment', '29': 'Manufacture of motor vehicles', '30': 'Manufacture of other transport equipment', '31': 'Manufacture of furniture', '32': 'Other manufacturing', '33': 'Repair and installation of machinery', '35': 'Electricity, gas, steam and air conditioning supply', '36': 'Water collection, treatment and supply', '37': 'Sewerage', '38': 'Waste collection, treatment and disposal', '39': 'Remediation and waste management', '41': 'Construction of buildings', '42': 'Civil engineering', '43': 'Specialised construction', '45': 'Motor vehicle trade and repair', '46': 'Wholesale trade', '47': 'Retail trade', '49': 'Land transport and pipelines', '50': 'Water transport', '51': 'Air transport', '52': 'Warehousing and transport support', '53': 'Postal and courier activities', '55': 'Accommodation', '56': 'Food and beverage services', '58': 'Publishing', '59': 'Film, video, TV and music production', '60': 'Programming and broadcasting', '61': 'Telecommunications', '62': 'Computer programming and consultancy', '63': 'Information services', '64': 'Financial services (except insurance and pensions)', '65': 'Insurance, reinsurance and pension funding', '66': 'Activities auxiliary to financial services', '68': 'Real estate', '69': 'Legal and accounting', '70': 'Head offices and management consultancy', '71': 'Architecture and engineering', '72': 'Scientific research and development', '73': 'Advertising and market research', '74': 'Other professional, scientific and technical activities', '75': 'Veterinary activities', '77': 'Rental and leasing', '78': 'Employment activities', '79': 'Travel agencies and tour operators', '80': 'Security and investigation', '81': 'Services to buildings and landscaping', '82': 'Office administration and business support', '84': 'Public administration and defence', '85': 'Education', '86': 'Human health activities', '87': 'Residential care', '88': 'Social work', '90': 'Creative, arts and entertainment', '91': 'Libraries, archives and museums', '92': 'Gambling and betting', '93': 'Sports, amusement and recreation', '94': 'Membership organisations', '95': 'Repair of computers and household goods', '96': 'Other personal services', '97': 'Households as employers', '98': 'Households producing for own use', '99': 'Extraterritorial organisations' };
const ukSic = c => (c === '99999' ? 'Dormant company' : c === '74990' ? 'Non-trading company' : UK_SIC[String(c).slice(0, 2)] || '');
const UK_TYPE = { ltd: 'Private limited company', plc: 'Public limited company', llp: 'Limited liability partnership', 'private-unlimited': 'Private unlimited company', 'private-limited-guarant-nsc': 'Private company limited by guarantee', 'private-limited-guarant-nsc-limited-exemption': 'Private company limited by guarantee', 'limited-partnership': 'Limited partnership', 'oversea-company': 'Overseas company', 'charitable-incorporated-organisation': 'Charitable incorporated organisation', 'scottish-partnership': 'Scottish partnership' };
const ukType = t => UK_TYPE[t] || (t ? String(t).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : '—');
const ukD = d => (d ? fd(Date.parse(d)) : '—');
const ukStatus = s => { const t = String(s || 'unknown'); const k = /^active$/i.test(t) ? 'ok' : /dissolved|liquidation|insolvency|receivership|administration|removed|closed/i.test(t) ? 'bad' : ''; return `<span class="badge ${k}">${esc(t.replace(/-/g, ' ').toUpperCase())}</span>`; };
const ukNum = s => { const n = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); return /^\d{1,8}$/.test(n) ? n.padStart(8, '0') : /^[A-Z]{2}\d{6}$/.test(n) ? n : null; };

async function ukGet(path) {
  if (!window.sfAuth || typeof window.sfAuth.fetch !== 'function') throw { code: 'offline', message: 'The UK register needs the cloud version of Superfinancials (sign-in).' };
  let r; try { r = await window.sfAuth.fetch(path); } catch (e) { throw { code: 'network', message: 'Could not reach the server' }; }
  let b = null; try { b = await r.json(); } catch (e) { }
  if (!r.ok) throw { code: (b && b.code) || 'error', message: (b && b.message) || `Request failed (${r.status})` };
  return b;
}
function ukErr(e) {
  const m = esc(e && e.message || 'Something went wrong');
  return `<div class="callout" style="margin:12px 20px">${m}${e && e.code === 'not_granted' && window.sfAuth ? ` <button class="btn sm" data-uklogin>Sign in</button>` : ''}${e && e.code === 'not_configured' ? ' Set COMPANIES_HOUSE_API_KEY on the server to enable it.' : ''}</div>`;
}

/* ---------- route, navigation ---------- */
if (typeof ROUTES !== 'undefined' && typeof NAV_MKT !== 'undefined') {
  ROUTES.ukreg = { t: 'UK company register', code: 'UK', g: 'Private markets', e: 'Companies & deals', m: 'pri' };
  const grp = NAV_MKT.pri.find(([g]) => g === 'Companies & deals'); if (grp && !grp[1].includes('ukreg')) grp[1].push('ukreg');
}

/* ---------- search ---------- */
async function ukSearch(pg, q) {
  UK.q = q; UK.busy = true; UK.err = null; ukResults(pg);
  try { UK.res = await ukGet('/api/uk-companies?n=25&q=' + encodeURIComponent(q)); } catch (e) { UK.res = null; UK.err = e; }
  UK.busy = false; ukResults(pg);
}
function ukResults(pg) {
  const el = $('#ukR', pg); if (!el) return;
  if (UK.busy) { el.innerHTML = '<p class="note" style="padding:12px 20px">Searching the register…</p>'; return; }
  if (UK.err) { el.innerHTML = ukErr(UK.err); return; }
  if (!UK.res) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="pb flush" id="ukT"></div><div class="pf"><span>${nf(UK.res.total, 0)} matches on the register${UK.res.total > UK.res.items.length ? `; showing the first ${UK.res.items.length}` : ''}.</span><span>Source: Companies House</span></div>`;
  table($('#ukT', el), { dense: true, rows: UK.res.items, empty: '<b>No companies match</b>Try a different name or the company number.', cols: [
    { k: 'n', h: 'Company', f: x => `<a class="tk" data-go="ukreg" data-p="${esc(x.number)}" href="#ukreg.${esc(x.number)}" style="font-family:var(--f-ui)">${esc(x.name)}</a><div class="sub" style="max-width:420px">${esc(x.address || '')}</div>` },
    { k: 'no', h: 'Number', f: x => `<span class="mono">${esc(x.number)}</span>` },
    { k: 's', h: 'Status', f: x => ukStatus(x.status) },
    { k: 't', h: 'Type', f: x => `<span class="sub">${esc(ukType(x.type))}</span>` },
    { k: 'c', h: 'Incorporated', a: 'r', f: x => ukD(x.created) },
  ] });
}

/* ---------- company ---------- */
async function ukCompany(el, num) {
  el.innerHTML = '<section class="panel"><p class="note" style="padding:16px 20px">Loading the register record…</p></section>';
  let c; try { c = await ukGet('/api/uk-companies/' + encodeURIComponent(num)); } catch (e) { el.innerHTML = `<section class="panel">${ukErr(e)}</section>`; return; }
  const P = c.profile; const acc = P.accounts, conf = P.confirmation;
  const due = (d, over) => `${ukD(d)}${over ? ' <span class="badge bad">OVERDUE</span>' : ''}`;
  const flags = [P.hasInsolvency ? '<span class="badge bad">Insolvency history</span>' : '', P.liquidated ? '<span class="badge bad">Liquidated</span>' : '', P.hasCharges ? '<span class="badge">Has charges</span>' : ''].filter(Boolean).join(' ');
  el.innerHTML = `<section class="panel uk-co"><header class="ph"><span class="pt">${esc(P.name)}</span><span class="pm">${ukStatus(P.status)} <a class="btn sm ghost" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">View on Companies House</a></span></header>
    <div class="pb"><dl class="kv">
      <div><dt>Company number</dt><dd class="mono">${esc(c.number)}</dd></div>
      <div><dt>Status</dt><dd>${esc((P.status || '—').replace(/-/g, ' ').replace(/^./, x => x.toUpperCase()))}${P.statusDetail ? ` · ${esc(P.statusDetail.replace(/-/g, ' '))}` : ''}</dd></div>
      <div><dt>Company type</dt><dd>${esc(ukType(P.type))}</dd></div>
      <div><dt>Incorporated</dt><dd>${ukD(P.created)}</dd></div>
      ${P.ceased ? `<div><dt>Dissolved</dt><dd>${ukD(P.ceased)}</dd></div>` : ''}
      <div><dt>Registered office</dt><dd>${esc(P.address || '—')}</dd></div>
      <div><dt>Nature of business (SIC)</dt><dd>${P.sic.length ? P.sic.map(s => `<span class="mono">${esc(s)}</span> ${esc(ukSic(s))}`).join('<br>') : '—'}</dd></div>
      <div><dt>Accounts</dt><dd>Next due ${due(acc.nextDue, acc.overdue)}<div class="sub">Last made up to ${ukD(acc.lastMadeUpTo)}${acc.type ? ` · ${esc(acc.type.replace(/-/g, ' '))}` : ''}</div></dd></div>
      <div><dt>Confirmation statement</dt><dd>Next due ${due(conf.nextDue, conf.overdue)}<div class="sub">Last made up to ${ukD(conf.lastMadeUpTo)}</div></dd></div>
      ${P.previousNames.length ? `<div><dt>Previous names</dt><dd>${P.previousNames.map(x => `${esc(x.name)} <span class="sub">to ${ukD(x.to)}</span>`).join('<br>')}</dd></div>` : ''}
    </dl>${flags ? `<div class="row" style="margin-top:10px;gap:6px">${flags}</div>` : ''}</div></section>
    <div class="grid">${panelH('Officers', { cls: 'c7', id: 'ukO', flush: true, meta: c.officers ? `${c.officers.active} active · ${c.officers.resigned} resigned` : '' })}${panelH('People with significant control', { cls: 'c5', id: 'ukP', flush: true })}${panelH('Filing history', { cls: 'c7', id: 'ukF2', flush: true, meta: `<a href="${esc(c.link)}/filing-history" target="_blank" rel="noopener noreferrer">All filings</a>` })}${panelH('Charges (secured lending)', { cls: 'c5', id: 'ukCh', flush: true, meta: c.charges ? `${Math.max(0, c.charges.outstanding)} outstanding of ${c.charges.total}` : '' })}</div>
    <div class="pf" style="border:0;padding:4px 0"><span>Source: Companies House public register, fetched live. Contains public sector information licensed under the Open Government Licence v3.0.</span></div>`;
  const officers = () => {
    const rows = (c.officers ? c.officers.items : []).filter(x => UK.resigned || !x.resigned);
    const box = $('#ukO', el);
    box.innerHTML = '';
    table(box, { dense: true, rows, empty: c.officers ? '<b>No current officers listed</b>' : '<b>Officers are not available</b>', cols: [
      { k: 'n', h: 'Name', f: x => `${esc(x.name)}<div class="sub">${esc([x.occupation, x.nationality].filter(Boolean).join(' · '))}</div>` },
      { k: 'r', h: 'Role', f: x => esc(x.role) },
      { k: 'a', h: 'Appointed', a: 'r', f: x => ukD(x.appointed) },
      ...(UK.resigned ? [{ k: 'z', h: 'Resigned', a: 'r', f: x => ukD(x.resigned) }] : []),
    ] });
    if (c.officers && c.officers.resigned) box.insertAdjacentHTML('beforeend', `<div style="padding:8px 12px"><button class="btn sm ghost" data-ukres>${UK.resigned ? 'Hide' : 'Show'} resigned officers</button></div>`);
  };
  officers();
  on(el, 'click', '[data-ukres]', () => { UK.resigned = !UK.resigned; officers(); });
  table($('#ukP', el), { dense: true, rows: c.psc || [], empty: c.psc ? '<b>No people with significant control listed</b>' : '<b>Not available</b>', cols: [
    { k: 'n', h: 'Name', f: x => `${esc(x.name)}${x.ceased ? ' <span class="badge">Ceased</span>' : ''}<div class="sub" style="max-width:none;white-space:normal">${esc(x.natures.join('; '))}</div>` },
    { k: 'd', h: 'Notified', a: 'r', f: x => ukD(x.notified) },
  ] });
  table($('#ukF2', el), { dense: true, rows: c.filings || [], empty: '<b>No filings returned</b>', cols: [
    { k: 'd', h: 'Date', f: x => ukD(x.date) },
    { k: 'x', h: 'Filing', f: x => `${esc(x.description || x.type || '')}<div class="sub">${esc(x.category || '')}</div>` },
    { k: 'p', h: 'Document', a: 'r', f: x => x.doc ? `<a href="${esc(x.doc)}" target="_blank" rel="noopener noreferrer">PDF</a>` : '—' },
  ] });
  table($('#ukCh', el), { dense: true, rows: c.charges ? c.charges.items : [], empty: c.charges ? '<b>No charges registered</b>' : '<b>Not available</b>', cols: [
    { k: 'c', h: 'Created', f: x => ukD(x.created) },
    { k: 's', h: 'Status', f: x => `${esc(x.status)}${x.satisfied ? `<div class="sub">${ukD(x.satisfied)}</div>` : ''}` },
    { k: 'e', h: 'Persons entitled', f: x => `<span class="sub" style="max-width:220px">${esc(x.entitled.join(', ') || x.classification || '—')}</span>` },
  ] });
}

/* ---------- page ---------- */
PAGES.ukreg = (pg, p) => {
  const num = p ? ukNum(p) : null;
  pg.innerHTML = hdr('ukreg', 'Official records of UK-registered companies from Companies House: status, filings, officers, owners (people with significant control) and charges. Fetched live when you search or open a company.', `<a class="btn" href="${UK_FIND}/" target="_blank" rel="noopener noreferrer">Companies House</a>`) +
    `<section class="panel"><form class="uk-f" id="ukForm" role="search"><input class="inp" id="ukQ" type="search" maxlength="160" placeholder="Company name or number, e.g. Tesco or 00445790" aria-label="Search the UK company register" value="${esc(num ? '' : UK.q)}"><button class="btn pri" type="submit">Search</button></form><div id="ukR"></div></section><div id="ukC"></div>`;
  $('#ukForm', pg).addEventListener('submit', e => { e.preventDefault(); const q = $('#ukQ', pg).value.trim(); if (q.length < 2) return; const n = ukNum(q); if (n) go('ukreg', n); else { if (num) go('ukreg'); ukSearch(document.querySelector('#main .page') || pg, q); } });
  on(pg, 'click', '[data-uklogin]', () => window.sfAuth && window.sfAuth.goLogin());
  if (num) { $('#ukR', pg).innerHTML = UK.res ? `<p class="note" style="padding:8px 20px"><a href="#ukreg" data-go="ukreg">Back to results for “${esc(UK.q)}”</a></p>` : ''; ukCompany($('#ukC', pg), num); }
  else if (UK.auto && UK.q) { UK.auto = false; ukSearch(pg, UK.q); }
  else ukResults(pg);
};

/* ---------- data-desk private companies: register panel ---------- */
if (typeof PAGES !== 'undefined' && PAGES.pco) {
  const _pco = PAGES.pco;
  PAGES.pco = (pg, id) => {
    _pco(pg, id);
    try {
      const c = typeof PCO !== 'undefined' ? PCO[id] || PCOS[0] : null; if (!c || !c.adm) return;
      const n = ukNum(c.chNo); const uk = ['UK', 'GB'].includes(String(c.cc).toUpperCase());
      if (!n && !uk) return;
      const sec = document.createElement('section'); sec.className = 'panel';
      sec.innerHTML = `<header class="ph"><span class="pt">UK register (Companies House)</span><span class="pm">${n ? `<a href="#ukreg.${n}" data-go="ukreg" data-p="${n}">Full record</a>` : ''}</span></header><div class="pb" id="ukPc">${n ? '<p class="note">Loading…</p>' : `<p class="note">No company number is recorded for ${esc(c.name)}. <button class="btn sm" data-uksearch>Find on the UK register</button></p>`}</div>`;
      const h = $('.phd', pg); if (h) h.after(sec); else pg.prepend(sec);
      on(sec, 'click', '[data-uksearch]', () => { UK.q = c.name; UK.auto = true; go('ukreg'); });
      if (n) ukGet('/api/uk-companies/' + n).then(r => {
        const P = r.profile; const box = $('#ukPc', sec); if (!box) return;
        box.innerHTML = `<dl class="kv"><div><dt>Registered name</dt><dd>${esc(P.name)} ${ukStatus(P.status)}</dd></div><div><dt>Company number</dt><dd class="mono">${esc(r.number)}</dd></div><div><dt>Incorporated</dt><dd>${ukD(P.created)}</dd></div><div><dt>Accounts next due</dt><dd>${ukD(P.accounts.nextDue)}${P.accounts.overdue ? ' <span class="badge bad">OVERDUE</span>' : ''}</dd></div><div><dt>Active officers</dt><dd>${r.officers ? r.officers.active : '—'}</dd></div><div><dt>People with significant control</dt><dd>${r.psc && r.psc.length ? esc(r.psc.filter(x => !x.ceased).map(x => x.name).slice(0, 3).join(', ')) || '—' : '—'}</dd></div></dl>`;
      }).catch(e => { const box = $('#ukPc', sec); if (box) box.innerHTML = ukErr(e); });
    } catch (e) { console.error(e); }
  };
}

/* ---------- main search box: UK register results ----------
   Typing three or more characters in the top search box adds, after the app's
   own results: up to three matching UK companies (fetched in the background,
   debounced and cached, then the list refreshes) and "Search the UK register
   for …", which opens the register page with the search run. A company
   number opens that company directly. Shown only in the cloud version; hidden
   if the server has no Companies House key. */
const UKS = { cache: new Map(), timer: null, off: false, login: false };
function ukLiveFetch(t) {
  const k = t.toLowerCase(); if (UKS.cache.has(k) || UKS.off || UKS.login) return;
  clearTimeout(UKS.timer);
  UKS.timer = setTimeout(async () => {
    if (UKS.cache.has(k)) return;
    UKS.cache.set(k, { loading: true });
    try { const r = await ukGet('/api/uk-companies?n=5&q=' + encodeURIComponent(t)); UKS.cache.set(k, { items: r.items || [], total: r.total || 0 }); }
    catch (e) {
      if (e && (e.code === 'not_configured' || e.code === 'offline')) UKS.off = true;
      if (e && e.code === 'not_granted') UKS.login = true;
      UKS.cache.set(k, { err: e && e.message || 'Search failed' });
    }
    if (UKS.cache.size > 100) UKS.cache.delete(UKS.cache.keys().next().value);
    // Refresh the open dropdown if the user is still looking at this query.
    const inp = document.getElementById('gsearch');
    if (inp && document.activeElement === inp && inp.value.trim().toLowerCase() === k) inp.dispatchEvent(new Event('input'));
  }, 400);
}
if (typeof searchItems === 'function') {
  const _si = searchItems;
  searchItems = function (q, opt = {}) {
    const res = _si(q, opt);
    try {
      if (!opt.funcs || UKS.off || !window.sfAuth || typeof window.sfAuth.fetch !== 'function') return res;
      const t = String(q || '').trim(); if (t.length < 3) return res;
      const row = (a, b, c) => `<div class="a">${a}</div><div class="b">${b}</div>${c ? `<div class="c">${c}</div>` : ''}`;
      const num = ukNum(t);
      if (num) return [...res, { kind: 'ukreg', html: row('UK register', `Open company ${esc(num)}`, 'Companies House'), run: () => go('ukreg', num) }];
      const k = t.toLowerCase(); const hit = UKS.cache.get(k); const extra = [];
      if (hit && hit.items) hit.items.slice(0, 3).forEach(x => extra.push({ kind: 'ukreg', html: row(esc(x.name), 'UK company', `${esc(x.number)} · ${esc(String(x.status || '').replace(/-/g, ' '))}${x.address ? ' · ' + esc(x.address) : ''}`), run: () => go('ukreg', x.number) }));
      // Skip the network for an exact ticker or page code: the user is not looking for a company.
      // Cancelling also drops a lookup still pending from an earlier keystroke (e.g. "aap" before "aapl").
      const exact = !!(res[0] && res[0].s >= 100);
      if (!hit && !exact) ukLiveFetch(t); else if (!hit) clearTimeout(UKS.timer);
      const status = UKS.login ? 'Sign in to search the register' : hit && hit.items ? `${nf(hit.total, 0)} matches on Companies House` : hit && hit.err ? esc(hit.err) : exact ? 'Companies House' : 'Searching Companies House…';
      extra.push({ kind: 'ukreg', html: row('UK register', `Search for “${esc(t)}”`, status), run: () => { UK.q = t; UK.auto = true; go('ukreg'); } });
      return [...res, ...extra];
    } catch (e) { console.error(e); return res; }
  };
}
