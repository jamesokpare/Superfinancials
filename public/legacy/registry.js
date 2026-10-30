/* =====================================================================
   Superfinancials — company registry (global)
   Next.js port add-on, loaded after superfinancials.js
   (src/components/LegacyApp.tsx). Adds "Company registry" under
   Private markets › Companies & deals. One search covers:
     - companies the developer enters in the Data studio ("Company registry"
       tab; stored in adm_reg: everyone reads, only the platform owner writes)
     - the UK register, Companies House (live, /api/uk-companies)
     - the global LEI register, GLEIF, 200+ countries (live, /api/companies)
   Live registers are fetched through the server (signed-in users only; API
   keys stay on the server). Data-desk private companies with a UK company
   number (chNo) show a register panel on their profile.
   Old links (#ukreg.<number>) still open the UK record.
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
/** SH01 allotments in the last two years. */
const ukAllot24 = c => (c.allotments || []).filter(x => Date.parse(x.allotted || x.filed) >= Date.now() - 730 * 864e5).length;
const ukNum = s => { const n = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); return /^\d{1,8}$/.test(n) ? n.padStart(8, '0') : /^[A-Z]{2}\d{6}$/.test(n) ? n : null; };

async function ukGet(path) {
  if (!window.sfAuth || typeof window.sfAuth.fetch !== 'function') throw { code: 'offline', message: 'The live registers need the signed-in version of Superfinancials.' };
  let r; try { r = await window.sfAuth.fetch(path); } catch (e) { throw { code: 'network', message: 'Could not reach the server' }; }
  let b = null; try { b = await r.json(); } catch (e) { }
  if (!r.ok) throw { code: (b && b.code) || 'error', message: (b && b.message) || `Request failed (${r.status})` };
  return b;
}
function ukErr(e) {
  const m = esc(e && e.message || 'Something went wrong');
  return `<div class="callout" style="margin:12px 20px">${m}${e && e.code === 'not_granted' && window.sfAuth ? ` <button class="btn sm" data-uklogin>Sign in</button>` : ''}${e && e.code === 'not_configured' ? ' Set COMPANIES_HOUSE_API_KEY on the server to enable it.' : ''}</div>`;
}


/* ---------- a Companies House (UK) record ---------- */
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
    <div class="grid">${panelH('Officers', { cls: 'c7', id: 'ukO', flush: true, meta: c.officers ? `${c.officers.active} active · ${c.officers.resigned} resigned` : '' })}${panelH('People with significant control', { cls: 'c5', id: 'ukP', flush: true })}${panelH('Filing history', { cls: 'c7', id: 'ukF2', flush: true, meta: `<a href="${esc(c.link)}/filing-history" target="_blank" rel="noopener noreferrer">All filings</a>` })}${panelH('Charges (secured lending)', { cls: 'c5', id: 'ukCh', flush: true, meta: c.charges ? `${Math.max(0, c.charges.outstanding)} outstanding of ${c.charges.total}` : '' })}${panelH('Share allotments (SH01)', { cls: 'c12', id: 'ukA', flush: true, meta: c.allotments ? `${c.allotments.length} allotment${c.allotments.length === 1 ? '' : 's'} on file${ukAllot24(c) ? ` · ${ukAllot24(c)} in the last two years` : ''}` : '' })}</div>
    <div class="pf" style="border:0;padding:4px 0"><span>Source: Companies House public register, fetched live. Contains public sector information licensed under the Open Government Licence v3.0.</span></div>`;
  const officers = () => {
    const rows = (c.officers ? c.officers.items : []).filter(x => UK.resigned || !x.resigned);
    const box = $('#ukO', el);
    box.innerHTML = '';
    table(box, { dense: true, rows, empty: c.officers ? '<b>No current officers listed</b>' : '<b>Officers are not available</b>', cols: [
      { k: 'n', h: 'Name', f: x => `${x.id ? `<a class="tk" ${regHref('off~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a>` : esc(x.name)}<div class="sub">${esc([x.occupation, x.nationality].filter(Boolean).join(' · '))}</div>` },
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
  table($('#ukA', el), { dense: true, rows: c.allotments || [], empty: c.allotments ? '<b>No share allotments filed</b>A company files form SH01 within a month of issuing new shares, for example in a funding round.' : '<b>Not available</b>', cols: [
    { k: 'a', h: 'Shares allotted on', f: x => ukD(x.allotted) },
    { k: 'f', h: 'Filed', f: x => `<span class="sub">${ukD(x.filed)}</span>` },
    { k: 'c', h: 'Share capital after the allotment', a: 'r', f: x => x.capital.length ? x.capital.map(k => `${esc(k.ccy)} ${k.figure == null ? '—' : nf(k.figure, k.figure % 1 ? 2 : 0)}`).join('<br>') : '—' },
    { k: 'p', h: 'Document', a: 'r', f: x => x.doc ? `<a href="${esc(x.doc)}" target="_blank" rel="noopener noreferrer">SH01 (PDF)</a>` : '<span class="sub">paper filing</span>' },
  ] });
  $('#ukA', el).insertAdjacentHTML('beforeend', '<p class="note" style="padding:0 12px 10px">New shares issued, for example in a funding round. The register gives the date and the total nominal share capital after the allotment; the number of shares and the price paid are in the SH01 document.</p>');
  table($('#ukCh', el), { dense: true, rows: c.charges ? c.charges.items : [], empty: c.charges ? '<b>No charges registered</b>' : '<b>Not available</b>', cols: [
    { k: 'c', h: 'Created', f: x => ukD(x.created) },
    { k: 's', h: 'Status', f: x => `${esc(x.status)}${x.satisfied ? `<div class="sub">${ukD(x.satisfied)}</div>` : ''}` },
    { k: 'e', h: 'Persons entitled', f: x => `<span class="sub" style="max-width:220px">${esc(x.entitled.join(', ') || x.classification || '—')}</span>` },
  ] });
}


/* =====================================================================
   Global part: shared helpers
   ===================================================================== */
const REG = { mode: 'co', q: '', cc: '', res: null, err: null, busy: false, auto: false, desk: {}, deskSt: 'off', db: null };
const REG_LS = 'sf.reg.v1';
const REG_STATUS = ['Active', 'Inactive', 'Dissolved', 'In liquidation', 'In administration', 'Struck off', 'Unknown'];
const REG_SRC = { dd: ['DATA DESK', 'live desk'], uk: ['COMPANIES HOUSE', ''], lei: ['GLEIF', ''], no: ['BRØNNØYSUND', ''], fr: ['SIRENE', ''] };
const regLei = s => { const n = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); return /^[A-Z0-9]{18}\d{2}$/.test(n) ? n : null; };
/** The app's country codes use UK for the United Kingdom; registers use GB. */
const regCC = c => { const u = String(c || '').toUpperCase(); return u === 'GB' ? 'UK' : u; };
const regCN = c => (c ? (typeof ddCN === 'function' ? ddCN(regCC(c)) : regCC(c)) : '—');
const regStatus = s => { const t = String(s || 'Unknown'); const k = /^active$/i.test(t) ? 'ok' : /dissolved|inactive|liquidation|insolvency|receivership|administration|removed|closed|struck|lapsed|retired|annulled|merged/i.test(t) ? 'bad' : ''; return `<span class="badge ${k}">${esc(t.replace(/[-_]/g, ' ').toUpperCase())}</span>`; };
const regSrc = k => `<span class="badge ${REG_SRC[k][1]}">${REG_SRC[k][0]}</span>`;
const regHref = p => `href="#registry.${esc(p)}" data-go="registry" data-p="${esc(p)}"`;
const regUrl = u => (typeof safeUrl === 'function' ? safeUrl(u) : /^https?:\/\//i.test(String(u || '')) ? String(u) : '#');
/** "a | b | c" lines → arrays of trimmed fields; blank lines dropped. */
const regLines = (txt, n) => String(txt || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 300).map(l => { const f = l.split('|').map(x => x.trim().slice(0, 300)); while (f.length < n) f.push(''); return f; });
const regDate = s => { const t = String(s || '').trim(); return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(t) ? t : ''; };
const regD = d => (!d ? '—' : /^\d{4}$/.test(d) ? d : /^\d{4}-\d{2}$/.test(d) ? fd(Date.parse(d + '-01'), { month: 'short', year: 'numeric' }) : fd(Date.parse(d)));

/* ---------- registry entries the developer publishes from the Data studio (adm_reg) ----------
   Anyone can read them; only the platform owner (an admin) can write them. The database
   enforces that (row-level security on adm_* collections), not just this page. */
try { const c = JSON.parse(localStorage.getItem(REG_LS) || 'null'); if (c && c.d) { REG.desk = c.d; REG.deskSt = 'cached'; } } catch (e) { }
(async () => {
  const cl = window.claude && typeof window.claude.use === 'function' ? window.claude : null; if (!cl) return;
  const db = await withTimeout(cl.use('db'), 10000); if (!db) return; REG.db = db;
  db.collection('adm_reg').onSnapshot(snap => {
    const m = {}; snap.docs.forEach(d => { if (d.exists !== false) m[d.id] = d.data(); });
    REG.desk = m; REG.deskSt = 'on'; try { localStorage.setItem(REG_LS, JSON.stringify({ d: m })); } catch (e) { }
    if (typeof state !== 'undefined' && ['registry', 'studio'].includes(state.r) && !document.querySelector('.mw') && !(typeof STU !== 'undefined' && STU.busy) && document.activeElement?.id !== 'regQ') { try { render(); } catch (e) { console.error(e); } }
  }, () => { });
})();
const regEntries = () => Object.entries(REG.desk).map(([id, x]) => ({ ...x, id }));
function regDeskSearch(q, cc) {
  const t = String(q || '').trim().toLowerCase(); const want = cc ? regCC(cc) : '';
  const hit = x => !t || [x.name, x.regNo, x.lei, ...(x.prev || []).map(p => p.name)].some(v => v && String(v).toLowerCase().includes(t));
  return regEntries().filter(x => (!want || regCC(x.cc) === want) && hit(x))
    .sort((a, b) => (String(a.name).toLowerCase().startsWith(t) ? 0 : 1) - (String(b.name).toLowerCase().startsWith(t) ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
}

/* ---------- route, navigation ---------- */
if (typeof ROUTES !== 'undefined' && typeof NAV_MKT !== 'undefined') {
  ROUTES.registry = { t: 'Company registry', code: 'CR', g: 'Private markets', e: 'Companies & deals', m: 'pri' };
  ROUTES.ukreg = { ...ROUTES.registry }; // old links (#ukreg.<number>) keep working
  const grp = NAV_MKT.pri.find(([g]) => g === 'Companies & deals'); if (grp && !grp[1].includes('registry')) grp[1].push('registry');
}

/* ---------- search ---------- */
async function regSearch(pg, q) {
  REG.q = q; REG.busy = true; REG.err = null; REG.res = null; regResults(pg);
  if (REG.mode === 'off') { try { REG.res = { officers: await ukGet(`/api/uk-officers?n=25&q=${encodeURIComponent(q)}`) }; } catch (e) { REG.err = e; } REG.busy = false; regResults(pg); return; }
  try { REG.res = await ukGet(`/api/companies?n=25&q=${encodeURIComponent(q)}${REG.cc ? '&cc=' + encodeURIComponent(REG.cc) : ''}`); } catch (e) { REG.err = e; }
  REG.busy = false; regResults(pg);
}
function regResults(pg) {
  const el = $('#regR', pg); if (!el) return;
  if (!REG.q) { el.innerHTML = ''; return; }
  if (REG.mode === 'off') { regOfficerResults(el); return; }
  const desk = regDeskSearch(REG.q, REG.cc).map(x => ({ src: 'dd', id: x.id, name: x.name, cc: x.cc, number: x.regNo, lei: x.lei, status: x.status, type: x.type, created: x.inc, address: x.addr, reg: x.registry }));
  const live = REG.res ? REG.res.items : [];
  const rows = [...desk, ...live];
  const S = REG.res && REG.res.sources; const st = (k, l) => !S ? '' : S[k].total != null ? `${l}: ${nf(S[k].total, 0)} matches` : S[k].error ? `${l}: unavailable (${esc(S[k].error)})` : '';
  const foot = [`Data desk: ${desk.length}`, st('uk', 'Companies House'), st('no', 'Brønnøysund'), st('fr', 'SIRENE'), st('lei', 'GLEIF')].filter(Boolean).join(' · ');
  el.innerHTML = `${REG.busy ? '<p class="note" style="padding:8px 20px">Searching the registers…</p>' : ''}${REG.err ? ukErr(REG.err) : ''}<div class="pb flush" id="regT"></div><div class="pf"><span>${foot}</span><span>Live registers show their first 25 matches</span></div>`;
  table($('#regT', el), { dense: true, rows, empty: REG.busy ? '<b>Searching…</b>' : '<b>No companies match</b>Try another spelling, the registration number or the LEI.', cols: [
    { k: 'n', h: 'Company', f: x => `<a class="tk" ${regHref(x.src + '~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a><div class="sub" style="max-width:420px">${esc(x.address || '')}</div>` },
    { k: 'c', h: 'Country', f: x => esc(regCN(x.cc)) },
    { k: 'no', h: 'Number', f: x => `<span class="mono">${esc(x.number || '—')}</span>${x.lei && x.src !== 'lei' ? `<div class="sub mono">LEI ${esc(x.lei)}</div>` : x.src === 'lei' ? `<div class="sub mono">LEI ${esc(x.id)}</div>` : ''}` },
    { k: 's', h: 'Status', f: x => regStatus(x.status) },
    { k: 'src', h: 'Source', f: x => regSrc(x.src) },
    { k: 'd', h: 'Incorporated', a: 'r', f: x => regD(x.created) },
  ] });
}

/* ---------- UK officers (Companies House): search results and one officer's appointments ---------- */
function regOfficerResults(el) {
  const r = REG.res && REG.res.officers; const rows = r ? r.items : [];
  el.innerHTML = `${REG.busy ? '<p class="note" style="padding:8px 20px">Searching UK officers…</p>' : ''}${REG.err ? ukErr(REG.err) : ''}<div class="pb flush" id="regT"></div><div class="pf"><span>${r ? `Companies House: ${nf(r.total, 0)} officers match` : ''}</span><span>First 25 matches · born shows month and year only, as on the register</span></div>`;
  table($('#regT', el), { dense: true, rows, empty: REG.busy ? '<b>Searching…</b>' : '<b>No officers match</b>Try the surname first, e.g. “Smith John”.', cols: [
    { k: 'n', h: 'Officer', f: x => `<a class="tk" ${regHref('off~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a><div class="sub" style="max-width:420px">${esc(x.address || '')}</div>` },
    { k: 'b', h: 'Born', f: x => esc(x.born || '—') },
    { k: 'a', h: 'Appointments', a: 'r', f: x => x.appointments == null ? '—' : nf(x.appointments, 0) },
    { k: 'd', h: 'Details', f: x => `<span class="sub">${esc(x.description || '')}</span>` },
  ] });
}
async function regOfficer(el, id) {
  el.innerHTML = '<section class="panel"><p class="note" style="padding:16px 20px">Loading the officer\'s appointments…</p></section>';
  let r; try { r = await ukGet('/api/uk-officers/' + encodeURIComponent(id)); } catch (e) { el.innerHTML = `<section class="panel">${ukErr(e)}</section>`; return; }
  el.innerHTML = `<section class="panel"><header class="ph"><span class="pt">${esc(r.name || 'Officer')}</span><span class="pm">${r.born ? `born ${esc(r.born)} · ` : ''}${r.active} active of ${r.total} appointments <a class="btn sm ghost" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">View on Companies House</a></span></header><div class="pb flush" id="regOffT"></div><div class="pf"><span>Source: Companies House officer appointments</span><span>Showing up to 50</span></div></section>`;
  table($('#regOffT', el), { dense: true, rows: r.items, empty: '<b>No appointments listed</b>', cols: [
    { k: 'c', h: 'Company', f: x => `${x.number ? `<a class="tk" ${regHref('uk~' + x.number)} style="font-family:var(--f-ui)">${esc(x.company)}</a>` : esc(x.company)}<div class="sub mono">${esc(x.number || '')}</div>` },
    { k: 's', h: 'Company status', f: x => ukStatus(x.status) },
    { k: 'r', h: 'Role', f: x => `${esc(x.role)}${x.occupation ? `<div class="sub">${esc(x.occupation)}</div>` : ''}` },
    { k: 'a', h: 'Appointed', a: 'r', f: x => ukD(x.appointed) },
    { k: 'z', h: 'Resigned', a: 'r', f: x => x.resigned ? ukD(x.resigned) : '<span class="up">current</span>' },
  ] });
}

/* ---------- a GLEIF (LEI) record ---------- */
async function regLeiCompany(el, lei) {
  el.innerHTML = '<section class="panel"><p class="note" style="padding:16px 20px">Loading the GLEIF record…</p></section>';
  let c; try { c = await ukGet('/api/companies/lei/' + encodeURIComponent(lei)); } catch (e) { el.innerHTML = `<section class="panel">${ukErr(e)}</section>`; return; }
  const P = c.profile, R = c.registration; const uk = regCC(P.cc) === 'UK' && ukNum(P.number);
  const rel = x => x ? `<a class="tk" ${regHref('lei~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a> <span class="sub">${esc(regCN(x.cc))} · ${esc(x.id)}</span>` : '—';
  el.innerHTML = `<section class="panel uk-co"><header class="ph"><span class="pt">${esc(P.name)}</span><span class="pm">${regStatus(P.status)} ${regSrc('lei')} <a class="btn sm ghost" href="${esc(regUrl(c.link))}" target="_blank" rel="noopener noreferrer">View on GLEIF</a></span></header>
    <div class="pb"><dl class="kv">
      <div><dt>LEI</dt><dd class="mono">${esc(c.lei)}</dd></div>
      <div><dt>Country</dt><dd>${esc(regCN(P.cc))}${P.jurisdiction && P.jurisdiction !== P.cc ? ` <span class="sub">jurisdiction ${esc(P.jurisdiction)}</span>` : ''}</dd></div>
      <div><dt>Registration number</dt><dd class="mono">${esc(P.number || '—')}</dd></div>
      <div><dt>Registry</dt><dd>${P.registryWeb ? `<a href="${esc(regUrl(P.registryWeb))}" target="_blank" rel="noopener noreferrer">${esc(P.registry || 'Registry')}</a>` : esc(P.registry || '—')}</dd></div>
      <div><dt>Legal form</dt><dd>${esc(P.legalForm || '—')}</dd></div>
      <div><dt>Founded / registered</dt><dd>${regD(P.created)}</dd></div>
      ${P.ended ? `<div><dt>Ended</dt><dd>${regD(P.ended)}</dd></div>` : ''}
      <div><dt>Legal address</dt><dd>${esc(P.legalAddress || '—')}</dd></div>
      ${P.hqAddress && P.hqAddress !== P.legalAddress ? `<div><dt>Headquarters</dt><dd>${esc(P.hqAddress)}</dd></div>` : ''}
      ${P.otherNames.length ? `<div><dt>Other names</dt><dd>${P.otherNames.map(x => `${esc(x.name)}${x.type ? ` <span class="sub">${esc(x.type)}</span>` : ''}`).join('<br>')}</dd></div>` : ''}
      <div><dt>LEI registration</dt><dd>${esc(R.status || '—')}<div class="sub">Renewal due ${regD(R.renewal)} · updated ${regD(R.updated)}</div></dd></div>
      ${P.bic.length ? `<div><dt>BIC / SWIFT</dt><dd class="mono">${P.bic.map(esc).join(', ')}</dd></div>` : ''}
    </dl>${uk ? `<p class="note" style="margin:10px 0 0">Registered in the UK. <a ${regHref('uk~' + uk)}>Open the full Companies House record</a> for officers, owners and filings.</p>` : ''}</div></section>
    <div class="grid"><section class="panel c5"><header class="ph"><span class="pt">Parent companies</span></header><div class="pb"><dl class="kl"><div><dt>Direct parent</dt><dd>${rel(c.directParent)}</dd></div><div><dt>Ultimate parent</dt><dd>${c.ultimateParent && (!c.directParent || c.ultimateParent.id !== c.directParent.id) ? rel(c.ultimateParent) : c.ultimateParent ? 'Same as direct parent' : '—'}</dd></div></dl></div></section>${panelH('Subsidiaries with an LEI', { cls: 'c7', id: 'regKids', flush: true, meta: c.children ? `${nf(c.children.total, 0)} direct` : '' })}</div>
    <div class="pf" style="border:0;padding:4px 0"><span>Source: GLEIF Global LEI Index, fetched live (open data, CC0). Officers, owners and filings come from the national registry linked above.</span></div>`;
  table($('#regKids', el), { dense: true, rows: c.children ? c.children.items : [], empty: c.children ? '<b>No subsidiaries report this company as their parent</b>' : '<b>Not available</b>', cols: [
    { k: 'n', h: 'Company', f: x => `<a class="tk" ${regHref('lei~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a>` },
    { k: 'c', h: 'Country', f: x => esc(regCN(x.cc)) },
    { k: 's', h: 'Status', f: x => regStatus(x.status) },
  ] });
}

/* ---------- a Norwegian or French register record ---------- */
async function regNatCompany(el, src, id) {
  el.innerHTML = '<section class="panel"><p class="note" style="padding:16px 20px">Loading the register record…</p></section>';
  let c; try { c = await ukGet(`/api/companies/${src}/${encodeURIComponent(id)}`); } catch (e) { el.innerHTML = `<section class="panel">${ukErr(e)}</section>`; return; }
  el.innerHTML = `<section class="panel uk-co"><header class="ph"><span class="pt">${esc(c.name)}</span><span class="pm">${regStatus(c.status)} ${regSrc(src)} <a class="btn sm ghost" href="${esc(regUrl(c.link))}" target="_blank" rel="noopener noreferrer">View on the register</a></span></header>
    <div class="pb"><dl class="kv">
      <div><dt>${src === 'no' ? 'Organisation number' : 'SIREN'}</dt><dd class="mono">${esc(c.number)}</dd></div>
      <div><dt>Country</dt><dd>${esc(regCN(c.cc))}</dd></div>
      <div><dt>Legal form</dt><dd>${esc(c.type || '—')}</dd></div>
      <div><dt>Founded</dt><dd>${regD(c.created)}</dd></div>
      ${c.registered ? `<div><dt>Registered</dt><dd>${regD(c.registered)}</dd></div>` : ''}
      <div><dt>Address</dt><dd>${esc(c.address || '—')}</dd></div>
      <div><dt>Industry</dt><dd>${esc(c.industry || '—')}</dd></div>
      ${c.employees != null ? `<div><dt>Employees</dt><dd>${nf(c.employees, 0)}</dd></div>` : ''}
      ${c.web ? `<div><dt>Website</dt><dd><a href="${esc(regUrl(c.web))}" target="_blank" rel="noopener noreferrer">${esc(String(c.web).replace(/^https?:\/\//, ''))}</a></dd></div>` : ''}
    </dl></div></section>
    ${c.officers.length ? `<div class="grid">${panelH('Directors and officers', { cls: 'c12', id: 'regNo', flush: true, meta: `${c.officers.length}` })}</div>` : ''}
    <div class="pf" style="border:0;padding:4px 0"><span>Source: ${esc(c.registry)}, fetched live. ${esc(c.licence)}.</span></div>`;
  if (c.officers.length) table($('#regNo', el), { dense: true, rows: c.officers, cols: [{ k: 'n', h: 'Name', f: r => esc(r.name) }, { k: 'r', h: 'Role', f: r => esc(r.role || '—') }] });
}

/* ---------- a data-desk registry entry ---------- */
function regDeskCompany(el, id) {
  const x = REG.desk[id];
  if (!x) { el.innerHTML = `<section class="panel"><div class="empty"><b>${REG.deskSt === 'off' ? 'Loading the registry…' : 'This registry entry no longer exists'}</b>It may have been removed in the Data studio.</div></section>`; return; }
  const own = typeof ADM !== 'undefined' && ADM.owner;
  el.innerHTML = `<section class="panel uk-co"><header class="ph"><span class="pt">${esc(x.name)}</span><span class="pm">${regStatus(x.status)} ${regSrc('dd')}${own ? ' <button class="btn sm" data-regedit>Edit</button>' : ''}</span></header>
    <div class="pb"><dl class="kv">
      <div><dt>Registration number</dt><dd class="mono">${esc(x.regNo || '—')}</dd></div>
      <div><dt>Country</dt><dd>${esc(regCN(x.cc))}</dd></div>
      <div><dt>Registry</dt><dd>${esc(x.registry || '—')}</dd></div>
      <div><dt>Legal form</dt><dd>${esc(x.type || '—')}</dd></div>
      <div><dt>Incorporated</dt><dd>${regD(x.inc)}</dd></div>
      ${x.dis ? `<div><dt>Dissolved</dt><dd>${regD(x.dis)}</dd></div>` : ''}
      <div><dt>Registered address</dt><dd>${esc(x.addr || '—')}</dd></div>
      <div><dt>Industry</dt><dd>${esc(x.industry || '—')}</dd></div>
      ${x.lei ? `<div><dt>LEI</dt><dd class="mono"><a ${regHref('lei~' + x.lei)}>${esc(x.lei)}</a></dd></div>` : ''}
      ${x.web ? `<div><dt>Website</dt><dd><a href="${esc(regUrl(x.web))}" target="_blank" rel="noopener noreferrer">${esc(String(x.web).replace(/^https?:\/\//, ''))}</a></dd></div>` : ''}
      ${(x.prev || []).length ? `<div><dt>Previous names</dt><dd>${x.prev.map(p => `${esc(p.name)}${p.to ? ` <span class="sub">to ${regD(p.to)}</span>` : ''}`).join('<br>')}</dd></div>` : ''}
    </dl>${x.notes ? `<p class="note" style="margin:10px 0 0;white-space:pre-wrap">${esc(x.notes)}</p>` : ''}${regCC(x.cc) === 'UK' && ukNum(x.regNo) ? `<p class="note" style="margin:10px 0 0"><a ${regHref('uk~' + ukNum(x.regNo))}>Open the live Companies House record</a></p>` : ''}</div></section>
    <div class="grid">${panelH('Officers & directors', { cls: 'c7', id: 'regO', flush: true })}${panelH('Shareholders & owners', { cls: 'c5', id: 'regOw', flush: true })}${panelH('Filings', { cls: 'c12', id: 'regF', flush: true })}</div>
    <div class="pf" style="border:0;padding:4px 0"><span>Source: ${x.srcUrl ? `<a href="${esc(regUrl(x.srcUrl))}" target="_blank" rel="noopener noreferrer">${esc(x.srcName || 'Data desk')}</a>` : esc(x.srcName || 'Superfinancials data desk')}. Entered by the data desk${x.upd ? `, updated ${fd(Date.parse(x.upd))}` : ''}.</span></div>`;
  table($('#regO', el), { dense: true, rows: x.officers || [], empty: '<b>No officers recorded</b>', cols: [{ k: 'n', h: 'Name', f: r => esc(r.name) }, { k: 'r', h: 'Role', f: r => esc(r.role || '—') }, { k: 'a', h: 'Appointed', a: 'r', f: r => regD(r.from) }] });
  table($('#regOw', el), { dense: true, rows: x.owners || [], empty: '<b>No owners recorded</b>', cols: [{ k: 'n', h: 'Name', f: r => `${esc(r.name)}${r.kind ? `<div class="sub">${esc(r.kind)}</div>` : ''}` }, { k: 'p', h: 'Held', a: 'r', f: r => (r.pct === '' || r.pct == null ? '—' : esc(r.pct) + (isFinite(+r.pct) ? '%' : '')) }] });
  table($('#regF', el), { dense: true, rows: x.filings || [], empty: '<b>No filings recorded</b>', cols: [{ k: 'd', h: 'Date', f: r => regD(r.date) }, { k: 'x', h: 'Filing', f: r => esc(r.desc || '—') }, { k: 'u', h: 'Document', a: 'r', f: r => (r.url ? `<a href="${esc(regUrl(r.url))}" target="_blank" rel="noopener noreferrer">Open</a>` : '—') }] });
  on(el, 'click', '[data-regedit]', () => regEd(id));
}

/* ---------- page ---------- */
PAGES.registry = (pg, p) => {
  const m = /^(uk|lei|dd|no|fr|off)~(.+)$/.exec(p || ''); const kind = m ? m[1] : null, key = m ? m[2] : null;
  const cc = typeof ccOpts === 'function' ? ccOpts().slice(1) : [];
  pg.innerHTML = hdr('registry', 'Company records from around the world in one search: the live national registers of the UK (Companies House), Norway (Brønnøysund) and France (SIRENE), the global LEI register (GLEIF, 200+ countries) and companies entered by the Superfinancials data desk. Open a company for its registration details, officers, owners, filings and group structure where the source has them.', `<a class="btn" href="https://search.gleif.org/" target="_blank" rel="noopener noreferrer">GLEIF</a><a class="btn" href="${UK_FIND}/" target="_blank" rel="noopener noreferrer">Companies House</a>`) +
    `<section class="panel"><form class="uk-f" id="regForm" role="search"><select class="inp" id="regMode" aria-label="Search for" style="flex:0 1 190px"><option value="co" ${REG.mode !== 'off' ? 'selected' : ''}>Companies</option><option value="off" ${REG.mode === 'off' ? 'selected' : ''}>People (UK officers)</option></select><input class="inp" id="regQ" type="search" maxlength="160" placeholder="${REG.mode === 'off' ? 'Officer name, e.g. Smith John' : 'Company name, registration number or LEI'}" aria-label="Search the company registry" value="${esc(kind ? '' : REG.q)}"><select class="inp" id="regCc" aria-label="Country" style="flex:0 1 220px"><option value="">All countries</option>${cc.map(([k, l]) => `<option value="${esc(k)}" ${k === REG.cc ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><button class="btn pri" type="submit">Search</button></form><div id="regR"></div></section><div id="regC"></div>`;
  $('#regForm', pg).addEventListener('submit', e => {
    e.preventDefault(); const q = $('#regQ', pg).value.trim(); REG.cc = $('#regCc', pg).value; const mode = $('#regMode', pg).value; if (mode !== REG.mode) { REG.mode = mode; REG.res = null; } if (q.length < (REG.mode === 'off' ? 3 : 2)) return;
    const lei = REG.mode === 'co' && regLei(q); if (lei) { go('registry', 'lei~' + lei); return; }
    if (kind) { REG.q = q; REG.auto = true; go('registry'); return; }
    regSearch(pg, q);
  });
  $('#regMode', pg).onchange = e => { const q = $('#regQ', pg); q.placeholder = e.target.value === 'off' ? 'Officer name, e.g. Smith John' : 'Company name, registration number or LEI'; $('#regCc', pg).disabled = e.target.value === 'off'; };
  on(pg, 'click', '[data-uklogin]', () => window.sfAuth && window.sfAuth.goLogin());
  if (kind) {
    $('#regR', pg).innerHTML = REG.q ? `<p class="note" style="padding:8px 20px"><a href="#registry" data-go="registry">Back to results for “${esc(REG.q)}”</a></p>` : '';
    const box = $('#regC', pg);
    if (kind === 'uk') { const n = ukNum(key); if (n) ukCompany(box, n); else box.innerHTML = '<section class="panel"><div class="empty"><b>Not a UK company number</b></div></section>'; }
    else if (kind === 'lei') { const l = regLei(key); if (l) regLeiCompany(box, l); else box.innerHTML = '<section class="panel"><div class="empty"><b>Not a valid LEI</b></div></section>'; }
    else if (kind === 'no' || kind === 'fr') regNatCompany(box, kind, key);
    else if (kind === 'off') regOfficer(box, key);
    else regDeskCompany(box, key);
  } else if (REG.auto && REG.q) { REG.auto = false; regSearch(pg, REG.q); }
  else if (REG.q) { regResults(pg); if (!REG.res && !REG.busy && !REG.err) regSearch(pg, REG.q); }
  else {
    const all = regEntries().sort((a, b) => String(b.upd || '').localeCompare(String(a.upd || ''))).slice(0, 12);
    if (all.length) { $('#regR', pg).innerHTML = `<header class="ph"><span class="pt" style="font-size:14px">Recently added by the data desk</span></header><div class="pb flush" id="regRecent"></div>`; table($('#regRecent', pg), { dense: true, rows: all, cols: [{ k: 'n', h: 'Company', f: x => `<a class="tk" ${regHref('dd~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a>` }, { k: 'c', h: 'Country', f: x => esc(regCN(x.cc)) }, { k: 'no', h: 'Number', f: x => `<span class="mono">${esc(x.regNo || '—')}</span>` }, { k: 's', h: 'Status', f: x => regStatus(x.status) }] }); }
  }
};
PAGES.ukreg = (pg, p) => PAGES.registry(pg, p ? (/^(uk|lei|dd|no|fr|off)~/.test(p) ? p : 'uk~' + p) : null);

/* =====================================================================
   Data studio: "Company registry" tab (platform owner only)
   ===================================================================== */
const REG_TPL = ['name', 'country', 'registration_number', 'registry', 'lei', 'status', 'legal_form', 'incorporated', 'dissolved', 'address', 'industry', 'website', 'officers', 'owners', 'filings', 'previous_names', 'notes', 'source', 'source_url'];
const REG_ALIAS = { name: ['name', 'company', 'company_name', 'legal_name'], country: ['country', 'cc', 'country_code', 'jurisdiction'], registration_number: ['registration_number', 'reg_no', 'registration_no', 'number', 'company_number', 'rc_number'], registry: ['registry', 'authority', 'registrar', 'register'], lei: ['lei'], status: ['status', 'company_status'], legal_form: ['legal_form', 'type', 'company_type', 'entity_type'], incorporated: ['incorporated', 'incorporation_date', 'date_of_incorporation', 'founded'], dissolved: ['dissolved', 'dissolution_date', 'date_of_dissolution'], address: ['address', 'registered_address', 'registered_office'], industry: ['industry', 'sector', 'nature_of_business'], website: ['website', 'web', 'url'], officers: ['officers', 'directors'], owners: ['owners', 'shareholders'], filings: ['filings'], previous_names: ['previous_names', 'former_names'], notes: ['notes', 'description'], source: ['source', 'source_name'], source_url: ['source_url', 'source_link'] };
const regSlug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const regNorm = (s, n) => String(s ?? '').trim().slice(0, n);
const regWeb = u => { const t = String(u || '').trim(); return /^https?:\/\/[^\s]+$/i.test(t) ? t.slice(0, 300) : ''; };
const regStatusOf = s => REG_STATUS.find(x => x.toLowerCase() === String(s || '').trim().toLowerCase()) || (String(s || '').trim() ? regNorm(s, 40) : 'Active');
/** Form or spreadsheet values → a registry document. Returns { doc } or { err }. */
function regDoc(v) {
  const name = regNorm(v.name, 200), cc = typeof ddCC === 'function' ? ddCC(v.country) : regCC(v.country);
  if (!name) return { err: 'Company name is required' };
  if (!cc) return { err: `Unknown country "${regNorm(v.country, 40)}"` };
  const lei = v.lei ? regLei(v.lei) : ''; if (v.lei && !lei) return { err: `LEI "${regNorm(v.lei, 30)}" is not 20 characters` };
  for (const k of ['incorporated', 'dissolved']) if (v[k] && !regDate(v[k])) return { err: `${k === 'incorporated' ? 'Incorporated' : 'Dissolved'} date must be YYYY-MM-DD, YYYY-MM or YYYY` };
  const doc = { name, cc, regNo: regNorm(v.registration_number, 60), registry: regNorm(v.registry, 160), lei: lei || '', status: regStatusOf(v.status), type: regNorm(v.legal_form, 120), inc: regDate(v.incorporated), dis: regDate(v.dissolved), addr: regNorm(v.address, 400), industry: regNorm(v.industry, 160), web: regWeb(v.website),
    officers: regLines(v.officers, 3).map(([n, r, d]) => ({ name: n, role: r, from: regDate(d) })).filter(x => x.name),
    owners: regLines(v.owners, 3).map(([n, p, k]) => ({ name: n, pct: p.replace(/%$/, ''), kind: k })).filter(x => x.name),
    filings: regLines(v.filings, 3).map(([d, x, u]) => ({ date: regDate(d), desc: x, url: regWeb(u) })).filter(x => x.desc || x.date),
    prev: regLines(v.previous_names, 2).map(([n, d]) => ({ name: n, to: regDate(d) })).filter(x => x.name),
    notes: regNorm(v.notes, 4000), srcName: regNorm(v.source, 160), srcUrl: regWeb(v.source_url), upd: new Date().toISOString() };
  return { doc };
}
const regIdFor = d => regSlug(`${d.cc}-${d.regNo || d.name}`) || regSlug(d.name) || uid();
async function regWrite(id, doc) {
  if (!REG.db) throw { code: 'unavailable', message: 'Database not available in this view' };
  await REG.db.collection('adm_reg').doc(id).set(doc); REG.desk[id] = doc;
  if (typeof secLog === 'function') secLog('registry.saved', { id });
}
async function regDelete(id) {
  if (!REG.db) throw { code: 'unavailable', message: 'Database not available in this view' };
  await REG.db.collection('adm_reg').doc(id).delete(); delete REG.desk[id];
  if (typeof secLog === 'function') secLog('registry.deleted', { id });
}
const regJoin = (a, f) => (a || []).map(f).join('\n');
function regEd(id) {
  if (!(typeof ADM !== 'undefined' && ADM.owner)) { toast('Only the platform owner can edit the company registry', true); return; }
  const x = id ? REG.desk[id] : null;
  const m = modal(x ? `Edit ${x.name}` : 'Add a company to the registry', `<div class="stu-form">${fI('name', 'Company name *', x?.name)}${fS('country', 'Country *', ccOpts(), x?.cc || STU.fcc)}${fI('registration_number', 'Registration number', x?.regNo)}${fI('registry', 'Registry / authority (e.g. Corporate Affairs Commission)', x?.registry)}${fS('status', 'Status', REG_STATUS, x?.status || 'Active')}${fI('legal_form', 'Legal form (e.g. Private limited company)', x?.type)}${fI('incorporated', 'Incorporated (YYYY-MM-DD)', x?.inc)}${fI('dissolved', 'Dissolved (YYYY-MM-DD)', x?.dis)}${fI('lei', 'LEI (optional, 20 characters)', x?.lei)}${fI('industry', 'Industry', x?.industry)}${fI('website', 'Website (https://…)', x?.web)}${fI('address', 'Registered address', x?.addr)}
    ${fT('officers', 'Officers & directors: one per line, "Name | Role | Appointed YYYY-MM-DD"', regJoin(x?.officers, r => [r.name, r.role, r.from].join(' | ')), 4, 'Ada Obi | Director | 2019-03-01')}${fT('owners', 'Shareholders & owners: one per line, "Name | % held | Type"', regJoin(x?.owners, r => [r.name, r.pct, r.kind].join(' | ')), 4, 'Founders Holdco Ltd | 62 | Company')}${fT('filings', 'Filings: one per line, "Date | Description | Link"', regJoin(x?.filings, r => [r.date, r.desc, r.url].join(' | ')), 4, '2026-06-30 | Annual return 2025 | https://…')}${fT('previous_names', 'Previous names: one per line, "Name | Until YYYY-MM-DD"', regJoin(x?.prev, r => [r.name, r.to].join(' | ')), 2)}${fT('notes', 'Notes', x?.notes, 3)}${fI('source', 'Source (e.g. CAC public search)', x?.srcName)}${fI('source_url', 'Source URL', x?.srcUrl)}</div><p class="note">Published entries are visible to everyone in Company registry and labelled DATA DESK. Only you can add, change or remove them.</p>`,
    { wide: true, actions: [{ label: 'Cancel', fn: c => c() }, { label: x ? 'Save changes' : 'Add company', cls: 'pri', fn: (c, mb) => {
      const r = regDoc(fGet(mb)); if (r.err) { toast(r.err, true); return; }
      const nid = id || regIdFor(r.doc); if (!id && REG.desk[nid]) { toast(`${REG.desk[nid].name} is already in the registry with this number. Edit it instead.`, true); return; }
      c(); stuRun(async () => { await regWrite(nid, r.doc); STU.prog = ''; return r.doc.name; });
    } }] });
  return m;
}
async function regImport(file) {
  let r; try { stuProg('Reading ' + file.name + '…'); r = await stuRead(file); } catch (e) { stuProg(''); toast(e.message || 'Could not read the file', true); return; } stuProg('');
  const sh = r && r.kind === 'sheet' && r.sheets.find(s => s.rows.length > 1); if (!sh) { toast('No table found. Use the template: one company per row.', true); return; }
  const hi = typeof stuHeader === 'function' ? stuHeader(sh.rows) : 0; const head = sh.rows[hi].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const col = {}; for (const [k, al] of Object.entries(REG_ALIAS)) { const i = head.findIndex(h => al.includes(h)); if (i >= 0) col[k] = i; }
  if (col.name == null || col.country == null) { toast('The file needs "name" and "country" columns. Download the template to see the layout.', true); return; }
  const ok = [], bad = [];
  sh.rows.slice(hi + 1).forEach((row, i) => {
    if (!row.some(c => String(c ?? '').trim())) return;
    const v = {}; for (const [k, j] of Object.entries(col)) { let c = row[j]; if (c instanceof Date) c = c.toISOString().slice(0, 10); v[k] = c == null ? '' : String(c); }
    for (const k of ['officers', 'owners', 'filings', 'previous_names']) v[k] = String(v[k] || '').split(/\s*;\s*/).join('\n'); // a cell holds "a | b; c | d"
    const d = regDoc(v); if (d.err) bad.push([hi + i + 2, d.err]); else ok.push(d.doc);
  });
  const ids = ok.map(regIdFor); const upd = ids.filter(id => REG.desk[id]).length;
  modal(`Import ${file.name}`, `<p style="margin:0"><b>${ok.length}</b> compan${ok.length === 1 ? 'y' : 'ies'} ready: ${ok.length - upd} new, ${upd} updating existing entries (matched on country and registration number).</p>${bad.length ? `<details><summary class="dn" style="cursor:pointer;margin:8px 0">${bad.length} row${bad.length > 1 ? 's' : ''} skipped</summary><ul class="stu-err">${bad.slice(0, 40).map(([n, e]) => `<li>Row ${n}: ${esc(e)}</li>`).join('')}</ul></details>` : ''}<div class="tw" style="max-height:260px;overflow:auto"><table class="t dense"><thead><tr><th>Company</th><th>Country</th><th>Number</th><th>Status</th></tr></thead><tbody>${ok.slice(0, 15).map(d => `<tr><td>${esc(d.name)}</td><td>${esc(regCN(d.cc))}</td><td class="mono">${esc(d.regNo || '—')}</td><td>${esc(d.status)}</td></tr>`).join('')}</tbody></table></div>`,
    { wide: true, actions: [{ label: 'Cancel', fn: c => c() }, ...(ok.length ? [{ label: `Import ${ok.length}`, cls: 'pri', fn: c => { c(); stuRun(async () => { for (let i = 0; i < ok.length; i++) { stuProg(`Saving ${i + 1} of ${ok.length}…`); await regWrite(ids[i], ok[i]); } STU.prog = ''; return `${ok.length} registry entries`; }); } }] : [])] });
}
if (typeof STU_TABS !== 'undefined' && typeof STU_FN !== 'undefined' && typeof STU_X !== 'undefined') {
  const at = STU_TABS.findIndex(([k]) => k === 'tpl'); if (!STU_TABS.some(([k]) => k === 'reg')) STU_TABS.splice(at < 0 ? STU_TABS.length : at, 0, ['reg', 'Company registry']);
  STU_FN.reg = el => {
    const xs = regEntries().filter(x => (!STU.fcc || regCC(x.cc) === STU.fcc) && stuMatch(x.name, x.regNo, x.registry, x.lei)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    el.innerHTML = `${REG.db ? '' : '<div class="callout" style="margin-bottom:12px">The database is not connected in this view, so registry entries can\'t be saved.</div>'}<section class="panel">${stuFilt('Filter companies')}<button class="btn sm pri" data-sta="regNew">Add company</button><label class="btn sm">Import file<input type="file" id="regFile" hidden accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv"></label><button class="btn sm ghost" data-sta="regTpl">Download template</button></div>
      ${xs.length ? `<div class="tw"><table class="t dense"><thead><tr><th>Company</th><th>Country</th><th>Number</th><th>Registry</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${xs.map(x => `<tr><td><a class="tk" ${regHref('dd~' + x.id)} style="font-family:var(--f-ui)">${esc(x.name)}</a></td><td>${esc(regCN(x.cc))}</td><td class="mono">${esc(x.regNo || '—')}</td><td class="sub">${esc(x.registry || '—')}</td><td>${regStatus(x.status)}</td><td class="sub">${x.upd ? fd(Date.parse(x.upd)) : '—'}</td><td class="r"><button class="btn sm ghost" data-sta="regEd" data-k="${esc(x.id)}">Edit</button><button class="btn sm ghost dn" data-sta="regDel" data-k="${esc(x.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><b>No companies yet</b>Add companies one at a time, or import a spreadsheet with one company per row. They appear in Company registry alongside the live registers.</div>`}</section>
      <p class="note" style="margin-top:10px">Spreadsheet columns: ${REG_TPL.map(c => `<span class="mono">${c}</span>`).join(', ')}. Only <span class="mono">name</span> and <span class="mono">country</span> are required. In the officers, owners, filings and previous_names cells, separate fields with <span class="mono">|</span> and people with <span class="mono">;</span>, for example <span class="mono">Ada Obi | Director | 2019-03-01; Tunde Bello | Secretary</span>. Rows with the same country and registration number update the existing entry.</p>`;
    const fi = $('#regFile', el); if (fi) fi.onchange = () => { const f = fi.files[0]; fi.value = ''; if (f) regImport(f); };
  };
  Object.assign(STU_X, {
    regNew: () => regEd(), regEd: k => regEd(k),
    regDel: k => { const x = REG.desk[k]; if (!x) return; confirmBox(`Delete ${x.name} from the company registry? It disappears for everyone.`, () => stuRun(async () => { await regDelete(k); STU.prog = ''; return 'deleted ' + x.name; })); },
    regTpl: () => { const ex = ['Example Industries Ltd', 'NG', 'RC123456', 'Corporate Affairs Commission', '', 'Active', 'Private company limited by shares', '2015-04-01', '', '12 Marina Road, Lagos', 'Manufacturing', 'https://example.com', 'Ada Obi | Director | 2015-04-01; Tunde Bello | Secretary | 2018-01-10', 'Founders Holdco Ltd | 62 | Company', '2026-06-30 | Annual return 2025 | ', '', '', 'CAC public search', 'https://search.cac.gov.ng']; sfSaveFile('superfinancials-company-registry-template.csv', [REG_TPL, ex].map(r => r.map(csvCell).join(',')).join('\n')); },
  });
}

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
      sec.innerHTML = `<header class="ph"><span class="pt">UK register (Companies House)</span><span class="pm">${n ? `<a href="#registry.uk~${n}" data-go="registry" data-p="uk~${n}">Full record</a>` : ''}</span></header><div class="pb" id="ukPc">${n ? '<p class="note">Loading…</p>' : `<p class="note">No company number is recorded for ${esc(c.name)}. <button class="btn sm" data-uksearch>Find on the UK register</button></p>`}</div>`;
      const h = $('.phd', pg); if (h) h.after(sec); else pg.prepend(sec);
      on(sec, 'click', '[data-uksearch]', () => { REG.q = c.name; REG.cc = 'UK'; REG.auto = true; go('registry'); });
      if (n) ukGet('/api/uk-companies/' + n).then(r => {
        const P = r.profile; const box = $('#ukPc', sec); if (!box) return;
        box.innerHTML = `<dl class="kv"><div><dt>Registered name</dt><dd>${esc(P.name)} ${ukStatus(P.status)}</dd></div><div><dt>Company number</dt><dd class="mono">${esc(r.number)}</dd></div><div><dt>Incorporated</dt><dd>${ukD(P.created)}</dd></div><div><dt>Accounts next due</dt><dd>${ukD(P.accounts.nextDue)}${P.accounts.overdue ? ' <span class="badge bad">OVERDUE</span>' : ''}</dd></div><div><dt>Active officers</dt><dd>${r.officers ? r.officers.active : '—'}</dd></div><div><dt>People with significant control</dt><dd>${r.psc && r.psc.length ? esc(r.psc.filter(x => !x.ceased).map(x => x.name).slice(0, 3).join(', ')) || '—' : '—'}</dd></div><div><dt>Share allotments (SH01)</dt><dd>${r.allotments ? (r.allotments.length ? `${r.allotments.length} on file · latest ${ukD(r.allotments[0].allotted || r.allotments[0].filed)}${ukAllot24(r) ? ` · ${ukAllot24(r)} in the last two years` : ''}` : 'None filed') : '—'}</dd></div></dl>`;
      }).catch(e => { const box = $('#ukPc', sec); if (box) box.innerHTML = ukErr(e); });
    } catch (e) { console.error(e); }
  };
}


/* ---------- main search box: company registry results ----------
   Typing three or more characters in the top search box adds, after the app's
   own results: matching data-desk registry entries (instant), up to three
   companies from the live registers (fetched in the background, debounced and
   cached, then the list refreshes) and "Search the company registry for …".
   An LEI or a UK company number opens that company directly. Live results are
   shown only in the cloud version (signed in). */
const REGS = { cache: new Map(), timer: null, off: false, login: false };
function regLiveFetch(t) {
  const k = t.toLowerCase(); if (REGS.cache.has(k) || REGS.off || REGS.login) return;
  clearTimeout(REGS.timer);
  REGS.timer = setTimeout(async () => {
    if (REGS.cache.has(k)) return;
    REGS.cache.set(k, { loading: true });
    try { const r = await ukGet('/api/companies?n=5&q=' + encodeURIComponent(t)); const tot = Object.values(r.sources || {}).reduce((a, s) => a + (s.total || 0), 0); REGS.cache.set(k, { items: r.items || [], total: tot }); }
    catch (e) {
      if (e && e.code === 'offline') REGS.off = true;
      if (e && e.code === 'not_granted') REGS.login = true;
      REGS.cache.set(k, { err: e && e.message || 'Search failed' });
    }
    if (REGS.cache.size > 100) REGS.cache.delete(REGS.cache.keys().next().value);
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
      if (!opt.funcs) return res;
      const t = String(q || '').trim(); if (t.length < 3) return res;
      const row = (a, b, c) => `<div class="a">${a}</div><div class="b">${b}</div>${c ? `<div class="c">${c}</div>` : ''}`;
      const lei = regLei(t); if (lei) return [...res, { kind: 'registry', html: row('Company registry', `Open LEI ${esc(lei)}`, 'GLEIF'), run: () => go('registry', 'lei~' + lei) }];
      const desk = regDeskSearch(t).slice(0, 3).map(x => ({ kind: 'registry', html: row(esc(x.name), 'Registered company', `${esc(regCN(x.cc))}${x.regNo ? ' · ' + esc(x.regNo) : ''} · data desk`), run: () => go('registry', 'dd~' + x.id) }));
      const live = !!(window.sfAuth && typeof window.sfAuth.fetch === 'function') && !REGS.off;
      const num = /^\d{8}$|^[A-Z]{2}\d{6}$/i.test(t) ? ukNum(t) : null;
      if (num && live) return [...res, ...desk, { kind: 'registry', html: row('Company registry', `Open UK company ${esc(num)}`, 'Companies House'), run: () => go('registry', 'uk~' + num) }];
      const extra = [...desk];
      const k = t.toLowerCase(); const hit = live ? REGS.cache.get(k) : null;
      if (hit && hit.items) hit.items.slice(0, 3).forEach(x => extra.push({ kind: 'registry', html: row(esc(x.name), 'Registered company', `${esc(regCN(x.cc))}${x.number ? ' · ' + esc(x.number) : ''} · ${({ uk: 'Companies House', no: 'Brønnøysund', fr: 'SIRENE' })[x.src] || 'GLEIF'}`), run: () => go('registry', x.src + '~' + x.id) }));
      // Skip the network for an exact ticker or page code: the user is not looking for a company.
      // Cancelling also drops a lookup still pending from an earlier keystroke (e.g. "aap" before "aapl").
      const exact = !!(res[0] && res[0].s >= 100);
      if (live && !hit && !exact) regLiveFetch(t); else if (!hit) clearTimeout(REGS.timer);
      const status = !live ? `${desk.length ? 'Data desk' : 'Sign in to search the live registers'}` : REGS.login ? 'Sign in to search the live registers' : hit && hit.items ? `${nf(hit.total, 0)} matches across registers` : hit && hit.err ? esc(hit.err) : exact ? 'UK and global registers' : 'Searching the registers…';
      extra.push({ kind: 'registry', html: row('Company registry', `Search for “${esc(t)}”`, status), run: () => { REG.q = t; REG.auto = true; go('registry'); } });
      return [...res, ...extra];
    } catch (e) { console.error(e); return res; }
  };
}

/* ---------- latest UK share allotments (Companies House filing stream, src/lib/ukstream) ----------
   Shown on the registry's start page: the last seven days of SH01 filings across all UK companies,
   read from ukalloc/d-<date>. New shares are usually a funding round; the register gives the date and
   the share capital after the allotment, not the amount raised. */
const ALLOT = { st: 'idle', items: [], q: '' };
async function allotLoad(pg) {
  if (ALLOT.st !== 'idle') return; ALLOT.st = 'loading';
  try {
    const cl = window.claude; const db = REG.db || (cl && typeof cl.use === 'function' ? await withTimeout(cl.use('db'), 10000) : null); if (!db) { ALLOT.st = 'off'; return; }
    const ids = Array.from({ length: 8 }, (_, i) => 'd-' + new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const col = db.collection('ukalloc'); let got = new Map();
    if (typeof col.getMany === 'function') got = await col.getMany(ids); else await Promise.all(ids.map(async id => { const s = await col.doc(id).get(); if (s && s.exists) got.set(id, s.data()); }));
    ALLOT.items = [...got.values()].flatMap(d => (d && Array.isArray(d.items) ? d.items : [])).sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(a.name).localeCompare(String(b.name)));
    ALLOT.st = 'on';
  } catch (e) { ALLOT.st = 'off'; }
  if (state.r === 'registry' && !REG.q) { const box = document.getElementById('allotP'); if (box) box.outerHTML = allotPanel(); }
}
function allotPanel() {
  if (ALLOT.st !== 'on' || !ALLOT.items.length) return '<section class="panel" id="allotP" hidden></section>';
  const q = ALLOT.q.trim().toLowerCase(); const rows = ALLOT.items.filter(x => !q || String(x.name || '').toLowerCase().includes(q) || String(x.num).toLowerCase().includes(q)).slice(0, 150);
  return `<section class="panel" id="allotP"><header class="ph"><span class="pt">Latest UK share allotments (SH01)</span><span class="pm">${nf(ALLOT.items.length, 0)} filed in the last 7 days · <input class="inp sm" id="allotQ" placeholder="Filter by company" value="${esc(ALLOT.q)}" style="width:180px"></span></header>
    <div class="tw" style="max-height:420px;overflow:auto"><table class="t dense"><thead><tr><th>Filed</th><th>Company</th><th>Shares allotted on</th><th class="r">Share capital after</th></tr></thead><tbody>${rows.map(x => `<tr><td class="sub">${ukD(x.filed)}</td><td><a class="tk" ${regHref('uk~' + x.num)} style="font-family:var(--f-ui)">${esc(x.name || x.num)}</a><div class="sub mono">${esc(x.num)}</div></td><td>${ukD(x.allotted)}</td><td class="r">${(x.capital || []).map(k => `${esc(k.ccy)} ${k.figure == null ? '—' : nf(k.figure, k.figure % 1 ? 2 : 0)}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="note" style="padding:0 20px">New shares issued by UK companies, usually in a funding round. The register gives the allotment date and the total nominal share capital afterwards; the number of shares and the price are in each SH01 document. Source: Companies House streaming API. Contains public sector information licensed under the Open Government Licence v3.0.</p></section>`;
}
if (typeof PAGES !== 'undefined' && PAGES.registry) {
  const _rg = PAGES.registry;
  PAGES.registry = (pg, p) => {
    _rg(pg, p);
    try {
      if (p || REG.q) return;
      pg.insertAdjacentHTML('beforeend', allotPanel()); allotLoad(pg);
      on(pg, 'input', '#allotQ', (e, el) => { ALLOT.q = el.value; const box = document.getElementById('allotP'); if (box) { const pos = el.selectionStart; box.outerHTML = allotPanel(); const n = document.getElementById('allotQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });
    } catch (e) { console.error(e); }
  };
}
