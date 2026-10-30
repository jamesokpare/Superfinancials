# Closing the remaining data gaps: what runs daily now, what's free, what's paid

Research and build of 30 October 2026. Four research passes ran web searches. Every official host was blocked from the build session, so prices and terms come from search snippets of the vendors' and publishers' own pages. Confirm each before you pay or publish. Items marked *unverified* rest on third-party or secondhand sources.

## Read first: licences, not data, are the risk

1. **EODHD and FMP standard plans are for personal use.**
   - EODHD says its listed packages are "intended for personal use only as commercial use requires a more thorough approach to licensing" ([EODHD](https://eodhd.com/financial-apis/commercial-vs-personal-license-use)).
   - FMP's terms prohibit showing its data on websites without a display agreement ([FMP terms](https://site.financialmodelingprep.com/terms-of-service)).
   - Superfinancials shows both publicly, so **it needs a commercial or display licence from whichever vendor it keeps.** Both quote on request.
2. **FRED is not one licence.**
   - "Public domain" and "Copyrighted: citation required" series can be shown with credit.
   - Other copyrighted series (ICE BofA, some S&P and Moody's series) need the owner's written permission ([FRED legal](https://fred.stlouisfed.org/legal)).
   - The macro sync now reads each series' notes and **skips any series whose owner restricts reuse**.
3. **Cboe index values** (VIX family) shown on a public site likely need a Cboe licence. The free CSV downloads are for personal use ([Cboe policies](https://cdn.cboe.com/resources/membership/Market_Data_Policies_Redlined.pdf)). Today the app gets them through EODHD, so the same commercial-licence question applies.

## What now runs daily, with credit

| Gap | Now in the app | Source and credit |
|---|---|---|
| Central-bank meetings | Decision dates for 15 central banks, rest of 2026 and 2027, in the calendar: Fed, ECB, BoE, BoJ, BoC, RBA, RBNZ, SNB, Riksbank, Norges Bank, SARB, RBI, Copom, CBRT, BI | Each bank's official calendar, linked on every event (`src/lib/macro/cbcal.ts`, reviewed yearly) |
| TED spread | **Funding spread:** SOFR minus 3-month T-bill. **Bank funding stress:** 3-month AA financial commercial paper minus 3-month T-bill (the credit-sensitive successor) | NY Fed and Federal Reserve Board via FRED; calculated |
| Inflation swaps | 5- and 10-year breakeven inflation, 5y5y forward | U.S. Treasury and Federal Reserve via FRED |
| ISM PMI | Philadelphia Fed, Empire State (NY Fed) and Dallas Fed manufacturing surveys, labelled "not the ISM PMI" | Each Reserve Bank, via FRED |
| Uranium, lithium, carbon, BDI, TD3C, BCOM, GSCI | Labelled proxy instruments: Sprott Physical Uranium Trust, URNM, LIT, KRBN, BDRY, BWET, DJP, GSG. Each note says it is a proxy and who owns the benchmark. | EODHD end-of-day prices (subject to the licence point above) |
| Every UK share allotment | All SH01 filings from the Companies House stream, 60 days kept, shown on the Company registry page | Companies House, Open Government Licence v3.0. Needs a free **streaming key**, `COMPANIES_HOUSE_STREAM_KEY` |
| Earnings beyond the 64 U.S. names | Reported EPS (diluted, else basic), revenue and shares outstanding for every U.S. filer: 8 quarters and 3 fiscal years, shown on company pages when no provider fundamentals exist | SEC EDGAR XBRL frames (data.sec.gov), public domain; credited "SEC EDGAR XBRL" with a link to EDGAR |
| Non-U.S. filings | Japan (EDINET), Korea (OpenDART), EU and UK annual reports in ESEF (filings.xbrl.org): latest filings per country on the Country data hub, and on matched desk instruments | EDINET, Financial Services Agency (Public Data License 1.0, free key `EDINET_API_KEY`); OpenDART, Financial Supervisory Service (free key `OPENDART_API_KEY`); filings.xbrl.org, XBRL International (no key) |
| China PMIs | Official NBS manufacturing, non-manufacturing and composite PMI, read from the English press releases; history builds month by month | National Bureau of Statistics of China |
| Business and consumer confidence | OECD composite leading indicator, business and consumer confidence (OECD and partners); European Commission Economic Sentiment Indicator and consumer confidence by EU country and the euro area | OECD (CC BY 4.0); European Commission DG ECFIN via Eurostat (CC BY 4.0) |
| Inflation expectations | Cleveland Fed expected inflation 1, 2, 5, 10, 30 years; Bank of England implied RPI inflation 5/10/20-year spot and 5y5y; ECB Survey of Professional Forecasters (long-term and 1–2 year HICP, long-term GDP and unemployment) | Federal Reserve Bank of Cleveland (via FRED); Bank of England yield curves; ECB SPF |
| Market-implied rates | Bill-implied policy path: 3m-in-3m and 6m-in-6m forwards and the change priced vs EFFR, in bp | Calculated from U.S. Treasury bill yields (public domain) and the NY Fed EFFR |
| FX forwards | EUR/USD and USD/CAD 3-month and 1-year forwards and forward points by covered interest parity | Calculated from ECB reference rate and AAA curve, Bank of Canada bills and USD/CAD, U.S. Treasury bills. Labelled CIP-implied: traded forwards also carry a cross-currency basis |
| VIX term structure | VIX/VIX3M, VIX9D/VIX, VVIX/VIX and VIX minus 21-day realised S&P 500 volatility | Calculated from Cboe's daily history files. Only ratios and spreads are stored, not index levels; Cboe's display terms still apply to the inputs |
| Nigerian money market and bonds | CBN interbank call, open buy back, NIBOR, MPR and T-bill rates; FGN bond auction results (offered, subscribed, allotted, marginal rate) in the calendar and as marginal-rate series | Central Bank of Nigeria money market indicators; Debt Management Office Nigeria auction result PDFs |
| Fund performance | Fund-level net IRR, TVPI, DPI, commitment, paid-in, distributed and value as each pension reports them (CalPERS private equity and private debt, Washington State Investment Board, Oregon OPERF private equity and real assets), weekly | Public records, credited per pension and report with the as-of date. WSIB IRRs are calculated by Hamilton Lane from GP data |
| Crowdfunding and Reg A raises | Regulation Crowdfunding (Form C) and Regulation A offerings in the "raising now" list, with portal, target, maximum and deadline | SEC quarterly data sets, public domain |
| UK amounts raised | Amount raised per SH01 (shares × amount paid including premium), read from the filing PDF; scanned paper forms stay blank | Companies House Document API, Open Government Licence v3.0 |
| EM sovereign spread | **EM sovereign spread proxy** (`US.EMSPRD`, bp): iShares EMB average yield to maturity minus the Treasury par yield interpolated at the fund's effective duration, daily, history built day by day | Calculated from BlackRock iShares published fund data and U.S. Treasury yields. Labelled "not the J.P. Morgan EMBI". **BlackRock's website terms restrict commercial reuse of site content; only the calculated spread is stored. Confirm with BlackRock before public display at scale.** |
| EU carbon | **EUA primary auction clearing price** (`EU.EUAAUC`, EUR/tCO2), several auctions a week, days with more than one auction averaged | EEX auction reports (common auction platform under the EU Auctioning Regulation). EEX's terms for reusing the report were not confirmed; the secondary-market EUA futures price stays paid (EEX from €75/month) |
| CBN, CBK, BoG, CBE, Banxico decisions | Meeting dates read automatically from each bank's own notice pages ("next MPC meeting…", BoG's yearly dates page, Banxico's announcement calendar), added to the calendar once published | Each bank's official notice, linked on every event |
| North American carbon | **RGGI** clearing price (`US.RGGIAUC`) and **California–Québec** current-vintage settlement price (`US.CCAAUC`), each quarterly auction | RGGI, Inc. auction results; California Air Resources Board results summary. Official program publications, credited and linked |
| Country risk | Sovereign default spread, country risk premium and total equity risk premium for each app country (`<CC>.DEFSPRD`, `.CRP`, `.ERP`), with the Moody's rating, added at each January/July update | Aswath Damodaran, NYU Stern, free with credit |
| SEC Q4 figures | Q4 revenue and EPS derived as fiscal year minus Q1–Q3 (companies report Q4 only in the 10-K; companyfacts has the same gap), marked * in the app | SEC EDGAR XBRL frames, public domain. EPS derived this way is approximate when the share count changed |
| Implied private valuations (UK) | Price paid per share in an SH01 × total shares in issue after it (statement of capital), shown as "implied" under the amount raised; skipped for issues at par or mixed currencies | Companies House Document API, OGL v3.0. Not a reported valuation |
| Uranium monthly price | Link to Cameco's page of UxC/TradeTech monthly averages on the uranium proxy's note; no figures stored | Cameco (data owned by UxC and TradeTech) |
| (earlier PRs) | IMF projections, NBER recessions, SEC filings, EIA, SH01 on company records | — |

## Gap by gap

### Nigerian T-bills (3M, 6M, 1Y) and money market (OPR, overnight, MPR)

**Free, official.**
- **MPR and decisions:** the policy rate is already in the app through BIS policy rates. MPC decisions are on [cbn.gov.ng/MonetaryPolicy/decisions.html](https://www.cbn.gov.ng/MonetaryPolicy/decisions.html), and communiqués are PDFs under `cbn.gov.ng/Out/{YYYY}/CCD/`. Latest reported: MPR cut 350 bp to **23.0%** on 22 Sep 2026, with the corridor at +50/−300 bp ([Nairametrics](https://nairametrics.com/2026/09/22/cbn-resets-mpr-by-350-basis-points-to-23-biggest-cut-since-2006/)). The 308th MPC date is not announced yet.
- **Monthly money-market indicators:** interbank call, OBB/OPR, T-bill rate, with an Excel export at `cbn.gov.ng/rates/mnymktind.asp?year=YYYY`. Whether it is current is *unverified*.
- **NTB primary auctions:** run roughly every two weeks on Wednesdays. Store both the stop rate and the true yield; for example, on 2 Sep 2026 the 364-day stop rate was 16.84%. The official results URL was not found. CBN publishes circulars, quoted by the press.
- **FGN bond auctions:** PDFs at [dmo.gov.ng/fgn-bonds/bonds-auction-results](https://dmo.gov.ng/fgn-bonds/bonds-auction-results).

**Paid, and cheaper than thought.**
- FMDQ's 2026 framework lists an **end-of-day composite fixings distribution licence (NITTY, NIBOR, NAFEX) at about ₦774,000–860,000 a year**, or about ₦387,000–430,000 for a single fixing. Earlier versions put it at ₦0.97–1.08m. That is far below the ₦13–34m real-time and delayed tiers ([FMDQ 2026 framework](https://fmdqgroup.com/exchange/wp-content/uploads/2026/08/FMDQ-Exchange-2026-Fees-and-Dues-Framework-2.pdf); [subscription form](https://fmdqgroup.com/exchange/wp-content/uploads/2022/03/FMDQ-Exchange-Data-Subscription-Form-and-Agreement.pdf); support@fmdqgroup.com).
- **This is the recommended route** for daily NITTY T-bill yields and NIBOR/OPR. Confirm with FMDQ that the tier allows website display.
- Trading Economics: Nigeria series from about $199/month, with redistribution enterprise-only ([pricing](https://tradingeconomics.com/api/pricing.aspx)).
- EODHD does not appear to carry Nigerian T-bills.

**Next build (free):** a monthly CBN money-market-indicators reader and a DMO bond-auction PDF reader. NTB auction stop rates can be entered in the Data studio from CBN circulars.

### Central-bank meeting dates and AGMs

**Done:** a curated calendar for 15 banks, linked to official pages.

**Read from the banks' notices once posted** (`src/lib/macro/cbnotices.ts`): CBN, CBK, Bank of Ghana, CBE, Banxico. **Not yet published:** BoJ's September and October 2027 dates, RBNZ's eighth 2027 date, and the rest of CBRT 2027. Add them in the Data studio when announced, or update `cbcal.ts`.

**Machine-readable:**
- Fed RSS for monetary-policy releases.
- Riksbank per-event `.ics` downloads.
- The rest are HTML or PDF.

**AGMs:**
- **U.S.:** proxy statements (DEF 14A) are already linked on equity pages. The meeting date is not a structured field, so it would need parsing from the cover page.
- **NGX:** AGM notices arrive through corporate disclosures, already wired.
- **Paid:** TMX Wall Street Horizon has shareholder-meeting dates since 2007. Price on request, available via [Intrinio](https://intrinio.com/products/corporate-events) or Cboe DataShop.
- EODHD and FMP have no AGM endpoint.

### EM sovereign spread and TED spread

- **TED:** done with the two calculated spreads above. FRED's `TEDRATE` ended in Jan 2022. CME Term SOFR needs a licence (delayed display about $50/month; [CME fees](https://www.cmegroup.com/market-data/files/cme-term-sofr-data-licensing-fees-january-2026.pdf)).
- **EM sovereign spread:** no free, licence-clean daily series exists.
  - FRED's ICE BofA EM series are corporate, not sovereign, and need ICE's permission to show. They are blocked by the new guard.
  - **Calculated option:** iShares EMB's published average yield or OAS (benchmark: J.P. Morgan EMBI Global Core) minus the Treasury yield at its duration (about 7 years), labelled "EMB-based proxy". BlackRock's site terms still need checking.
  - Annual cross-section: Aswath Damodaran's [country risk premiums](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html), free, credit Damodaran.
- **Paid:**
  - J.P. Morgan EMBI via J.P. Morgan index licensing, Bloomberg or LSEG (quote).
  - [Cbonds API](https://cbonds.com/api/bonds/) from about $350/month.
  - Bloomberg Terminal about $28–32k per seat per year (*unverified*).

### Daily uranium, lithium, EU carbon, Baltic Dry, TD3C, BCOM

**Done:** labelled proxies.

**Free, official, and only monthly or per auction:**
- **Uranium:** Cameco's monthly UxC/TradeTech average ([page](https://www.cameco.com/invest/markets/uranium-price); the data belongs to UxC and TradeTech, so link rather than copy).
- **EU carbon:** EEX EUA primary-auction results ([EEX](https://www.eex.com/en/market-data/environmentals/eu-ets-auctions); terms unconfirmed).
- **California carbon:** CARB/Québec quarterly auction results (government).
- **UK carbon:** UKA auctions via ICE.
- **Daily carbon:** Ember's carbon prices are **not usable**: its European electricity prices tool takes EU and UK ETS prices (front-December contract) from Montel, a commercial vendor, and states no open licence. The app uses EEX's EUA primary auction clearing prices instead (below).

**Paid:**

| Benchmark | Option | Price |
|---|---|---|
| Uranium | [UxC Ux Weekly](https://www.uxc.com/p/product/report/uxw) | $5,400/yr (3 users, display) |
| Uranium | TradeTech, Numerco | Quote |
| Lithium | SMM ([metal.com](https://buy.metal.com/)) | About $800–1,600/yr (*unverified*) |
| Lithium | Fastmarkets or Benchmark | Quote |
| Lithium | GFEX LC futures settlement | Ask GFEX for permission |
| EU carbon | EEX secondary end-of-day | From €75/month |
| EU carbon | ICE EUA futures | Quote |
| BDI and TD3C | Baltic Exchange (marketing@balticexchange.com) | Quote; free headline data only for member staff |
| BCOM | Bloomberg Index Services (commodities@bloombergindices.com) | Quote |
| S&P GSCI | S&P DJI | Quote |
| Several of the above | Trading Economics API | About $149–299/month; redistribution is enterprise (*unverified*) |

### ISM and China PMIs

**Done:** regional Fed manufacturing surveys.

**Free next:**
- **China:** the official NBS PMI (manufacturing, non-manufacturing, composite), released on the last day of each month. English releases are at `stats.gov.cn/english/PressRelease/YYYYMM/…` ([Sep 2026](https://www.stats.gov.cn/english/PressRelease/202610/t20261008_1965466.html)). The old `easyquery` API reportedly returns 403 since May 2026, so this needs a release-page reader. Credit the National Bureau of Statistics of China.
- **Global:** the OECD business confidence index (BCICP) and leading indicator, dataflow `OECD.SDD.STES,DSD_STES@DF_CLI`, CC BY 4.0.
- **Euro area:** the EC Economic Sentiment Indicator, Eurostat `teibs010` or ECB `RTD.M.S0.S.Y_ESIND.F`.

**Paid:**
- **ISM** historical and recent data by subscription, launched at $2,500/yr in 2014, current price on request (pmireports@ismworld.org). Redistribution needs an ISM licence.
- **Caixin and S&P Global PMIs:** S&P Global subscription, quote.
- **Chicago PMI:** MNI, quote.

### Earnings beyond the 64 U.S. names

**Free, U.S. (public domain):**
- **Actuals for every filer:** the SEC XBRL frames API. One call per concept per quarter, e.g. `data.sec.gov/api/xbrl/frames/us-gaap/EarningsPerShareDiluted/USD-per-shares/CY2026Q2.json`, about 6,000 companies. Use `companyfacts` to fill gaps.
- **Release detection:** 8-K item 2.02, already used for the 64.
- **Not available free for display:**
  - Upcoming dates: Nasdaq's calendar is personal-use only ([Nasdaq legal](https://www.nasdaq.com/legal)).
  - Consensus estimates.

**Free, non-U.S.:**
- Japan's EDINET (API v2, free key, Public Data License 1.0 with attribution).
- Korea's OpenDART (free key, about 10–20k calls/day).
- [filings.xbrl.org](https://filings.xbrl.org/docs/api) for EU/UK ESEF annual reports ("no restrictions on use").

**Paid:**

| Vendor | Price |
|---|---|
| EODHD | Calendar package $19.99/mo; Fundamentals (includes earnings trends) $59.99/mo; All-In-One $99.99/mo. **Commercial display quoted separately.** |
| FMP | Starter about $19–22, Premium about $59, Ultimate about $139–149/mo; global on Ultimate. **Display licence is enterprise.** |
| Massive (formerly Polygon) | Benzinga earnings add-on from $99/mo ([Massive](https://ny5.massive.com/blog/benzingadata-partnership)) |
| Finnhub | All-In-One about $3,500/mo |
| Wall Street Horizon, Zacks via Intrinio | Quote |

### Private rounds (amounts, valuations) and fund performance

**Free:**
- **U.S.:**
  - SEC Form C (Reg CF) and Reg A quarterly datasets: amounts and price per security ([SEC](https://www.sec.gov/data-research/sec-markets-data/regulation-data-sets)).
  - Form D, already wired.
- **UK:** each SH01's PDF (Companies House Document API) states the shares allotted and the amount paid per share, so amount raised = shares × price. These are text-layer PDFs, so this needs a PDF reader, best run in GitHub Actions.
- **Valuations:** no free source can be redistributed. Derive "implied" values only from price per share × shares in issue.

**Fund performance (free, public records):**

| Source | What | Frequency |
|---|---|---|
| [CalPERS](https://www.calpers.ca.gov/investments/about-investment-office/investment-organization/pep-fund-performance) | Per-fund net IRR and multiple (HTML) | Quarterly |
| [Washington State Investment Board](https://sib.wa.gov/docs/reports/quarterly/ir093025.pdf) | PDF at a predictable URL | Quarterly |
| [Oregon Treasury](https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2026/OPERF_Opportunity_Portfolio_-_Quarter_1_2026.pdf) | PDF | Quarterly |
| CalSTRS | PDF | Annual |

- DPI and TVPI can be computed from contributions, distributions and NAV.
- Cambridge Associates' preliminary benchmark headlines can be cited.

**Paid (third-party estimates):**

| Vendor | Price |
|---|---|
| PitchBook | About $12–40k per user per year |
| CB Insights | About $30–100k per year |
| Crunchbase Enterprise API | About $20–50k+ per year, plus display rights |
| Dealroom | About €12.6–17k per year |
| Tracxn | From about $550/month |
| Preqin, MSCI Burgiss | Quote |
| Briter Intelligence (Africa) | Quote |

### Every UK share allotment

**Done:** the stream reader. To switch it on:
1. On the Companies House Developer Hub, go to *Your applications*, create a live application, and add a **Streaming API key**.
2. Set it as `COMPANIES_HOUSE_STREAM_KEY` in Vercel.

**Limits:**
- Two connections per key.
- Connections drop nightly around 02:00–03:00 UK time.
- Resume points expire after some days (undocumented).

**On Vercel Hobby the job can run only once a day for up to 5 minutes**, which may not drain a full day's filings. Vercel Pro (hourly) or a GitHub Actions schedule would be more reliable.

### Options and implied volatility, credit ratings and CDS, FX forwards, inflation swaps, market-implied rates

- **Implied volatility:** the VIX family is already in the app via EODHD (see the licence point).
  - Free calculated additions: VIX/VIX3M term structure, VVIX/VIX, and VIX minus 21-day realised volatility.
  - Paid options chains: [ORATS](https://orats.com/ai-agents) delayed $99/mo or live $199/mo; Massive options about $99/mo; Tradier from about $10/mo; EODHD US Options (price on request); [Cboe DataShop](https://datashop.cboe.com/option-quotes-end-of-day-with-calcs) (redistribution extra).
- **Ratings, CDS and country risk:** EODHD's credit-risk API (Moody's/S&P/Fitch ratings, 10-year sovereign CDS, default spreads, country risk premium; Damodaran-sourced, about 157 countries) comes with **Fundamentals ($59.99/mo) or All-In-One ($99.99/mo)** ([EODHD](https://eodhd.com/financial-apis/credit-and-sovereign-risk-data-api)). Show it as "snapshot via Damodaran, as of …", not live. Live CDS: S&P Global Market Intelligence (quote).
- **FX forwards:**
  - Free calculated option: covered-interest-parity forwards from spot and SOFR, €STR and SONIA, labelled "CIP-implied, not a traded quote".
  - The cross-currency basis cannot be computed without traded forwards, so it is paid only (LSEG, Bloomberg).
  - India's FBIL publishes USD/INR forward premia (terms unknown).
- **Inflation swaps:**
  - **Done:** breakevens and 5y5y.
  - Free next: Cleveland Fed expected inflation (`EXPINF1YR`–`EXPINF30YR`), Bank of England implied inflation curves (Open Government Licence), ECB Survey of Professional Forecasters.
  - Swaps themselves are paid (Bloomberg, LSEG, ICE).
- **Market-implied policy rates:**
  - Free calculated option: a T-bill-implied path from the Treasury curve already in the app, compared with EFFR.
  - NY Fed Survey of Market Expectations, eight times a year.
  - Atlanta Fed Market Probability Tracker (terms to confirm).
  - Paid: **CME FedWatch end-of-day API from $25/month** ([CME](https://www.cmegroup.com/market-data/market-data-api/fedwatch-api.html)); display terms to confirm.

## Verifying formats

The "Data dry run" workflow's provider-samples step now also saves:
- EODHD's credit-risk responses and a proxy price;
- the copyright notes of every FRED series the app shows;
- the head of Cboe's VIX history file.

It also runs the app's own readers on one live response from each new official source (OECD leading indicators,
Eurostat sentiment, ECB SPF, BoE implied inflation, NBS PMI releases, ECB and Bank of Canada forward inputs, Cboe
history, EDINET, OpenDART, filings.xbrl.org, SEC frames and Reg CF / Reg A data sets, CBN, DMO, CalPERS, WSIB, Oregon)
and saves what was read: an empty or odd result points at a format to fix. The workflow also dry-runs the
international filings, SEC and pension syncs.

One run with the keys in GitHub secrets settles the open formats and licence labels. New secrets for that run:
`EDINET_API_KEY` and `OPENDART_API_KEY` (both free).
