/* =====================================================================
   Superfinancials — public pension fund reports on Fund performance
   Next.js port add-on, loaded after registry.js (src/components/LegacyApp.tsx).
   Funds written by src/lib/pensions/sync.ts (adm_priv/lp-*, gen
   'pension-sync') carry each reporting pension's own figures in `lps`
   (CalPERS, Washington State Investment Board, Oregon Treasury). Here:
     - fund size is unknown from these reports, so it shows as — (not $0)
     - funds too young for a meaningful IRR (reported N/M) are left out of
       the IRR tables and charts
     - a fund's page shows what each pension reports, with the source
   ===================================================================== */
'use strict';
const PNS = { lps: {} };
if (typeof admPrivApply === 'function') {
  const _apa = admPrivApply;
  admPrivApply = function () {
    _apa(); PNS.lps = {};
    try {
      const drop = new Set();
      ADM.priv.filter(x => x.kind === 'fund' && x.gen === 'pension-sync' && Array.isArray(x.lps)).forEach(x => {
        const id = 'PF.dd-' + admId(x._id).toLowerCase(); const f = PF[id]; if (!f) return;
        if (x.irr == null) { drop.add(id); delete PF[id]; return; }
        f.size = null; f.lps = x.lps; PNS.lps[id] = x.lps;
      });
      if (drop.size) for (let i = PFUNDS.length - 1; i >= 0; i--) if (drop.has(PFUNDS[i].id)) PFUNDS.splice(i, 1);
    } catch (e) { console.error(e); }
  };
}
function pnsPanel(f) {
  const lps = f.lps || []; if (!lps.length) return '';
  const m = v => v == null ? '—' : big(v, '$'); const x = v => v == null ? '—' : nf(v, 2) + '×';
  return `<section class="panel c12"><header class="ph"><span class="pt">${esc(f.name)}: what its public pension investors report</span></header><div class="tw"><table class="t dense"><thead><tr><th>Investor</th><th class="r">As of</th><th class="r">Committed</th><th class="r">Paid-in</th><th class="r">Distributed</th><th class="r">Value</th><th class="r">Net IRR</th><th class="r">TVPI</th><th class="r">DPI</th></tr></thead><tbody>${lps.map(l => `<tr><td>${esc(l.lp)}<div class="sub"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.src)}</a></div></td><td class="r">${esc(l.asof)}</td><td class="r">${m(l.commit)}</td><td class="r">${m(l.paid)}</td><td class="r">${m(l.dist)}</td><td class="r">${m(l.nav)}</td><td class="r ${l.irr == null ? '' : cls(l.irr)}">${l.irr == null ? 'N/M' : pc(l.irr, 1)}</td><td class="r">${x(l.tvpi)}</td><td class="r">${x(l.dpi)}</td></tr>`).join('')}</tbody></table></div><div class="pf"><span>Each pension's own figures: net IRR and multiples on its commitment, from its published report (public records). Value = remaining value (NAV) reported. The fund's headline row uses the most recent report.</span></div></section>`;
}
if (typeof PAGES !== 'undefined' && PAGES.funds) {
  const _funds = PAGES.funds;
  PAGES.funds = (pg, p) => { _funds(pg, p); try { const f = PF[p]; if (f && f.lps && f.lps.length) pg.insertAdjacentHTML('beforeend', `<div class="grid">${pnsPanel(f)}</div>`); } catch (e) { console.error(e); } };
}
