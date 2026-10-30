# Superfinancials

A markets, private-markets and research workspace. It started as a single-file
claude.ai artifact and is being moved to Next.js + Supabase in stages
(see [PLAN.md](PLAN.md)).

**Current state (Phase 1):** the original app runs unchanged inside Next.js.
Its claude.ai runtime calls (`window.claude.use(...)`) are served by Supabase
(auth, database, realtime, storage) and a server-side Claude API route.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

Without Supabase keys the app still runs, in browser-only mode: local
profiles, no sign-in, no shared features. That mode is useful for UI work.

## Setting up Supabase

1. **Keys.** In the Supabase dashboard open *Project Settings → API* and copy
   into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`: the project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable (or legacy anon) key
   - `SUPABASE_SERVICE_ROLE_KEY`: the secret / service-role key (server only, used by the seed script)
2. **Schema.** Run `supabase/migrations/20261029000000_init.sql`, either in
   *SQL Editor* (paste and run) or with the Supabase CLI:
   ```bash
   npx supabase link --project-ref YOUR-PROJECT-REF
   ```
   ```bash
   npx supabase db push
   ```
3. **Content.** Load the shared data exported from the original artifact
   (end-of-day prices, macro series, news, calendar, Nigerian listings):
   ```bash
   npm run seed
   ```
4. **Auth URLs.** In *Authentication → URL Configuration* set the Site URL
   (e.g. `http://localhost:3000`) and add `http://localhost:3000/login` (and
   your production `/login` URL) to the redirect allow list. Email links
   (confirmation, magic link) land on `/login`.
5. **Make yourself an admin.** Sign up in the app, then in *SQL Editor*:
   ```sql
   update profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
   Admins can edit shared content (prices, the Data studio) and see the Studio.

## AI features

Set `ANTHROPIC_API_KEY` in `.env.local` to enable the Copilot, AI analyst and
portfolio summaries. They call `POST /api/ai`, which requires a signed-in
user and streams Claude's answer back. The model defaults to `claude-opus-5-5`
(override with `SF_AI_MODEL`). The app's `quick` / `default` / `complex` tiers
map to low / medium / high effort.

## How it fits together

| Path | What it is |
|---|---|
| `public/legacy/superfinancials.js` | The original artifact script (≈9,950 lines), with small patches marked "Next.js port" |
| `src/app/legacy.css` | The original artifact styles |
| `src/legacy/shell.ts` | The static app shell markup the script renders into |
| `src/components/LegacyApp.tsx` | Installs the runtime shim, then loads the script once |
| `src/lib/claude-shim/` | `window.claude.use()` rebuilt: `db` (Firestore-style API on a Supabase table), `user`, `room` (Realtime), `assets` (Storage), `downloads`, `sample` (AI) |
| `src/app/login/` | Sign in, sign up, email link |
| `src/app/api/ai/` | Server-side Claude call for `sample` |
| `src/lib/providers/` | Clients for the external market-data, news and economic APIs |
| `src/app/api/providers/` | Data-connection status and health check |
| `src/lib/market/intraday.ts`, `src/app/api/intraday/` | Delayed quote and latest-session intraday bars from EODHD, on demand (security pages) |
| `public/legacy/connections.js` | Data sources page (connections, sync runs), landing-page connection list, intraday panel |
| `src/lib/market/` | Market sync: instrument → provider map, fetchers, writer |
| `src/app/api/cron/market-sync/` | Scheduled sync endpoint (Vercel Cron) |
| `src/lib/news/`, `src/app/api/cron/news-sync/` | News sync and its scheduled endpoint |
| `public/legacy/news-feed.js` | Adds provider headlines to the legacy news pages |
| `src/lib/fundamentals/`, `public/legacy/fundamentals.js` | Reported fundamentals: sync and the browser add-on |
| `public/legacy/history.js` | Loads each instrument's price history on demand |
| `public/legacy/earnings.js` | Reported earnings and consensus estimates in calendars, briefs and movers |
| `src/lib/registry/`, `src/lib/ukreg/`, `src/app/api/companies/`, `src/app/api/uk-companies/`, `public/legacy/registry.js` | Company registry: data-desk entries, Companies House (UK) and GLEIF (global) |
| `src/lib/macro/`, `src/app/api/cron/macro-sync/` | Daily sync of official macro data, calendars and SEC Form D private placements |
| `src/lib/africa/`, `src/app/api/cron/africa-sync/`, `src/app/api/africa/country/` | African markets sync (NGX snapshot, disclosures, company news, dividends, elections) and on-demand country profiles |
| `public/legacy/realdata.js` | Real-data mode: page adjustments (the mode itself is in `superfinancials.js`, marked "Next.js port") |
| `supabase/migrations/` | Schema and row-level security |
| `supabase/seed-data/` | Shared documents exported from the artifact's database |
| `public/i18n/` | Interface translations (zh, ja, ko, fr, de, es, pt) |

### Data model

All app data lives in one table, `docs(path, parent, id, data jsonb)`. A
document is addressed by a slash path like `orgs/<user-id>/members/<user-id>`,
exactly as the original Firestore-style store did. Access rules match the
artifact:

- `mkt`, `adm_*`, `energyinfra` and other shared content: anyone can read; admins write.
- `orgs`, `outbox`, `people`, `posts`, `likes`, `dm`, `fchat`: signed-in users read;
  each user writes only under their own id (`posts/<my-id>/…`).
- `pk/<id>`: each person's public encryption key; signed-in users read, only the owner writes.
- `data/users/<id>/…`: private to that user.

**Workspaces.** A signed-in user's workspace (watchlists, notes, alerts, graphs, dashboards, portfolio,
screens, models, clients, decks and preferences) is one document, `data/users/<id>/workspace`
(`{ type, v, savedAt, dev, ws }`), written by `public/legacy/workspace.js`. The browser keeps a copy in
`localStorage` (`sf.ws.<email>`) so the app opens at once and works offline:
- on sign-in the newer copy wins (by `savedAt`); a browser workspace with no saved copy is uploaded;
- edits are written about 1.5 s after the last change, and at once when the tab is hidden or closed;
  opening the app writes nothing, because `savedAt` changes only when the content does;
- a save from another device or tab replaces the open workspace when there are no unsaved edits
  (otherwise the later save wins);
- an encrypted workspace (Settings › workspace lock) is stored encrypted, so the database holds only ciphertext.

Local profiles (no account) stay in the browser only.

## Data connections

Server-side clients for every external data provider live in
`src/lib/providers/`. Each reads its key from an environment variable with
the **same name as the GitHub repository secret**, so production only needs
those secrets set. None are `NEXT_PUBLIC_`, so keys never reach the browser.

| Env var | Provider | Client | Covers |
|---|---|---|---|
| `AFRICA_API_KEY` | [Africa API](https://africa-api.com) | `createAfricaApi()` | 54 countries: indicators, exchanges, tickers, FX, trade, elections |
| `ALPHAVANTAGE_API_KEY` | [Alpha Vantage](https://www.alphavantage.co/documentation/) | `createAlphaVantage()` | Quotes, history, FX, fundamentals, economics, news sentiment |
| `COMPANIES_HOUSE_API_KEY` | [Companies House](https://developer-specs.company-information.service.gov.uk/) | `createCompaniesHouse()` | UK companies, officers, filings, PSCs |
| `CURRENTS_API_KEY` | [Currents API](https://currentsapi.services/en/docs/) | `createCurrents()` (official SDK `currentsapi`) | News |
| `DATABASE_URL` | Postgres / Supabase | `sql()` from `@/lib/db/postgres` (`postgres` package) | Direct SQL |
| `EODHD_API_KEY` | [EODHD](https://eodhd.com/financial-apis/) | `createEodhd()` (official SDK `eodhd`) | Global EOD/intraday/live prices, fundamentals, calendars, news |
| `EXCHANGERATE_API_KEY` | [ExchangeRate-API](https://www.exchangerate-api.com/docs/overview) | `createExchangeRate()` | FX rates, 160+ currencies |
| `FMP_API_KEY` | [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs) | `createFmp()` | Quotes, statements, ratios, history (stable API) |
| `FRED_API_KEY` | [FRED](https://fred.stlouisfed.org/docs/api/fred/) | `createFred()` | Economic time series |
| `MANSA_API_KEY` | [Mansa API](https://mansaapi.com) | `createMansa()` | African exchanges, stocks, indices, movers |
| `MARKETAUX_API_KEY` | [Marketaux](https://www.marketaux.com/documentation) | `createMarketaux()` | News with entity sentiment |
| `MARKETSTACK_API_KEY` | [Marketstack](https://marketstack.com/documentation_v2) | `createMarketstack()` | Global EOD/intraday prices (v2) |
| `MYSTOCKS_AFRICA_API_KEY` | [MyStocks Africa](https://mystocks.africa/partners/docs/market-data) | `createMyStocksAfrica()` | African quotes, candles, companies, news |
| `NEWSAPI_AI_KEY` | [NewsAPI.ai](https://newsapi.ai/documentation) | `createNewsApiAi()` (official SDK `eventregistry`) | News articles and events |
| `NGX_PULSE_API_KEY` | [NGX Pulse](https://ngxpulse.ng/api) | `createNgxPulse()` | NGX equities, market summary, NASD OTC |
| (no key) | [GLEIF](https://www.gleif.org/en/lei-data/gleif-api) | `createGleif()` | Legal entities with an LEI worldwide: registration numbers, registries, parents |

```ts
import { createFmp, createFred, createNgxPulse } from "@/lib/providers";

const cpi = await createFred().observations("CPIAUCSL", { units: "pc1" });
const ngx = await createNgxPulse().stocks();
// Cache in Next.js by passing fetch options to the REST clients:
const fmp = createFmp(undefined, { init: { next: { revalidate: 300 } } });
```

Every client has a `ping()`. To check which keys are set and working:

```bash
npm run providers:check
```

or, signed in, `GET /api/providers` (configured or not, with each one's env var and what it feeds) and
`GET /api/providers?check=1` (pings each). Signed out, `GET /api/providers` returns only the names, what
each feeds and whether it is set up, for the landing page. The **Data sources** page shows this list with a
"Test connections" button and the last run of every scheduled sync (from each sync's `_meta` doc). Errors are `ProviderError` /
`MissingKeyError` with key values redacted.

## Live market data

The app's Provider layer still generates every series, but real prices now
replace the simulated ones wherever a provider has them. A server-side sync
(`src/lib/market/`) pulls end-of-day prices from the configured APIs and
writes them into the `mkt` collection the app already reads. In the browser
`liveBuild()` splices them onto the simulated history and labels them
**REAL** with their source; anything not covered keeps its **SIM** label.

| Instruments | Sources, in order of preference |
|---|---|
| U.S. stocks and ETFs (98) | EODHD → FMP → Marketstack → Alpha Vantage |
| Global indices (27) | EODHD → FMP; Cboe volatility indices also from FRED |
| FX (25) and the Dollar Index | ExchangeRate-API → EODHD → FMP → FRED H.10 → Alpha Vantage; DXY computed from its six components |
| Government yields (76) | FRED for U.S. Treasuries, EODHD for other curves |
| Credit spreads, SOFR, economic indicators | FRED |
| Commodities | FMP futures; FRED spot WTI, Brent and Henry Hub; EODHD spot gold |
| Crypto | EODHD → FMP → Alpha Vantage |
| NGX All-Share and the data desk's NGX listings | NGX Pulse → Mansa → MyStocks Africa → Africa API |

Each run writes:
- `mkt/d-<date>`: that day's closes (`[close, change, date, source, note, [open, high, low, volume]]` per instrument;
  the last two only when present: open, high, low and volume come from EODHD, FMP, Marketstack and Alpha Vantage quotes)
- `mkt/_meta`: a one-line summary shown on the Sources panel
- `mkt/_hist`: an index of instruments that have history, with their last date
- `mkthist/<id>`: each instrument's daily history, one series per source, with open, high, low and
  volume arrays (`o`, `h`, `l`, `v`) when the provider has them, on the same split- and dividend-adjusted
  basis as the closes (FRED
  every week; metered providers backfill up to `MARKET_HISTORY_BUDGET`
  instruments per run)

Browsers load only `mkt` up front (about 11 KB). `public/legacy/history.js`
fetches an instrument's `mkthist` doc the first time its series is used (in
batches, one database query per batch), then rebuilds and re-renders.
History docs from earlier versions in `mkt` are moved on the next sync run.
- `adm_inst/AD.NG.*`: today's NGX close appended to each desk listing

Day documents older than 35 days are folded into the history documents, so
`mkt` stays small.

**Schedule.** `vercel.json` runs `GET /api/cron/market-sync` at 22:30 UTC on
weekdays (after the U.S. close). Set `CRON_SECRET` in the Vercel project, plus
`SUPABASE_SERVICE_ROLE_KEY` (or `DATABASE_URL`) so the sync can write.

**By hand:**

```bash
npm run market:sync -- --dry-run
```

```bash
npm run market:sync
```

`--only=EQ.AAPL,FX.USDNGN,NGX` limits a run to some instruments. The output
lists, per provider, how many instruments it resolved and any error.

## Market news

The Market news page now leads with **Latest headlines** from the connected
news providers. A news sync (`src/lib/news/`) pulls recent articles from
Marketaux (tickers and sentiment), NewsAPI.ai (broad business coverage),
Currents, Alpha Vantage (one `NEWS_SENTIMENT` request a run: market, economy and earnings stories with a
sentiment score and the tickers each story is relevant to) and EODHD (company news with sentiment for 4 tracked
U.S. companies a run, rotating through the list, `EODHD_NEWS_TICKERS`), plus African-markets queries, and the press-release feeds of official
sources (Federal Reserve, ECB, Bank of England, BLS, BEA, EIA, SEC, IMF; no key,
filter chip "Official sources"), and startup and deal news (TechCrunch Venture, Crunchbase News,
TechCabal, Techpoint Africa, Disrupt Africa, Wamda, Sifted, EU-Startups; RSS, no key, filter chip
"Startup and deal news": funding, fund and exit stories only, kept as headline, link and outlet plus
the round size read from the headline, never the publisher's text), and stores them in `mktnews/day-<date>`
documents. The same story from several providers is kept once (matched by URL,
then title) and headlines older than 14 days are removed.

In the browser, `public/legacy/news-feed.js` (loaded after the main script)
reads that collection and adds:
- a headlines panel at the top of Market news, filterable by provider,
  watchlist, portfolio and text;
- **Reported that day** on generated briefs about a company, when a headline
  about it appeared that session. The brief still marks the cause unconfirmed;
- headlines on each security page's News tab and the overview's news panel.

Headlines are linked to instruments by the provider's ticker tags and by
company names in the title. With no headlines stored, the pages look exactly
as before.

**Schedule.** `vercel.json` runs `GET /api/cron/news-sync` at 06:15 and
16:45 UTC daily (the Hobby plan allows each job once a day). By hand:

```bash
npm run news:sync -- --dry-run
```

## Fundamentals

Security pages, the screener and valuation comps now use **reported
financials** for the 64 U.S. equities instead of figures generated from model
parameters. A fundamentals sync (`src/lib/fundamentals/`) fetches, per
company, five fiscal years of income statement, balance sheet and cash flow,
trailing-twelve-month figures, shares outstanding, dividends, revenue growth,
forward EPS and the next earnings date, from EODHD (one call per company), then
Financial Modeling Prep, then Alpha Vantage. Results go to `fund/<id>`.

In the browser, `public/legacy/fundamentals.js` wraps the app's `fund()`:
valuation ratios (P/E, forward P/E, P/S, P/B, EV/EBITDA, dividend and FCF
yield) are recomputed from the live price; statements reported in another
currency are converted to USD at the app's FX rate. Pages say where the
figures come from (Financials tab, key stats, valuation and screener notes).
Companies without stored data keep their simulated figures and labels.

**NGX listings.** The data desk's NGX listings (`adm_inst/AD.NG.*`) are
covered too: full statements from EODHD (`<TICKER>.XNSA`) when it has them,
else key figures (market cap, shares, EPS or P/E, dividend, book value,
revenue, net income) from Mansa, MyStocks Africa, NGX Pulse or Africa API.
Those APIs' formats vary, so fields are found by common names. Figures stay in
the listing's currency (NGN). A listing with key figures only shows them on
its Financials tab; one with no data says so instead of showing blank tables.
`FUND_NGX_BUDGET` (default 10) sets how many NGX listings each run fetches.

**Earnings.** Each company's doc also holds its quarterly reports: report
date and timing, reported EPS (and revenue from FMP), the consensus EPS and
revenue estimates before each report, and EODHD's consensus trend (estimate
now vs 7, 30 and 90 days ago). `public/legacy/earnings.js` uses them for the
earnings calendar and event pages, earnings briefs and surprises on Market news,
movers' catalysts and chart markers; price reactions are still measured from
the app's prices. Companies without stored earnings keep the simulated schedule
and labels. A company that has reported since its last fetch is refetched first,
and each run pulls recent actuals and upcoming estimates for all companies from
one bulk calendar call.

**Schedule.** `GET /api/cron/fundamentals-sync` runs daily at 05:40 UTC and
refreshes up to `FUND_BUDGET` companies whose data is missing or older than
`FUND_REFRESH_DAYS`; next earnings dates for all companies come from one bulk
calendar call each run. To load everything at once:

```bash
npm run fundamentals:sync -- --budget=64
```

## Company registry (global)

**Private markets › Companies & deals › Company registry** searches five
sources at once and lists them together, each labelled with where it came from:

| Source | Coverage | How |
|---|---|---|
| Data desk | Companies you add in the Data studio | Shared database (`adm_reg`), searched in the browser |
| Brønnøysund | Norway, live (no key, NLOD 2.0) | `searchRegistry` / `GET /api/companies/no/<org number>` (`src/lib/registry/`) |
| recherche-entreprises (SIRENE + RNE) | France, live (no key, Licence Ouverte 2.0), with directors | `GET /api/companies/fr/<SIREN>` |
| Companies House | UK, live | `GET /api/uk-companies?q=`, `GET /api/uk-companies/<number>`; officers: `GET /api/uk-officers?q=`, `GET /api/uk-officers/<officer id>` (`src/lib/ukreg/`, needs `COMPANIES_HOUSE_API_KEY`) |
| GLEIF | ~2.9M legal entities with an LEI in 200+ countries, live | `GET /api/companies?q=&cc=`, `GET /api/companies/lei/<LEI>` (`src/lib/registry/`, no key) |

A country filter narrows the search (the UK register is skipped for other
countries), and an LEI typed into the search opens that company directly. A UK
company that also has an LEI is shown once, as its UK record.

- **People (UK officers)**: switch the search to people to find directors, secretaries and LLP members by
  name; an officer's page lists every company they are or were appointed to, linked to those records.
  Officer names on a UK company record link there too.
- **UK records** show status, type, incorporation, registered office, SIC
  codes, accounts and confirmation-statement deadlines, previous names,
  officers, people with significant control, filings (with PDFs) and charges.
- **GLEIF records** show the legal name, other names, legal and HQ addresses,
  the local registration number and the registry that holds it, legal form,
  status, LEI renewal, direct and ultimate parents, and subsidiaries.
- **Data-desk records** show what you entered: registration details, officers,
  shareholders, filings, previous names, notes and the source.

The live registers are fetched through the server for signed-in users only and
cached in memory for an hour. Old `#ukreg.<number>` links still open the UK
record. The **main search box** lists matching data-desk companies instantly,
up to three live matches (debounced and cached), and "Search for …"; exact
tickers and page codes don't trigger a lookup.

### Adding companies (Data studio)

**Admin › Data studio › Company registry** is where you add, edit, delete and
bulk-import companies. Only the platform owner can open the Data studio, and
the database enforces the same rule: `adm_reg` is readable by everyone but
writable only by admins (`profiles.is_admin`, see step 5 of the Supabase setup).
Import takes Excel or CSV with one company per row: `name` and `country` are
required; the template (Download template) lists every column. In the
officers, owners, filings and previous-names cells, separate fields with `|`
and entries with `;`. A row with the same country and registration number as an
existing entry updates it.

## Real-data mode

Every account sees **only real data**. The exception is the **demo workspace**
(Sign in → "Continue with the demo workspace"), which keeps the simulator's
sample data so the product can be shown off, labelled as before.

- **Private markets.** The simulator's 35 fictional companies, their deals and
  36 fictional funds are removed. What remains are data-desk entries (Data
  studio) and U.S. private placements from SEC Form D (below). New users get no
  sample fund commitments or example holdings; saved workspaces from before have
  them removed when they load. Quarterly operating KPIs for private companies
  are not connected, so those views say so instead of showing model figures.
- **Public markets.** Every instrument is a real security, but some had only
  simulated prices. Lists, tables, search, heatmaps and the overview now show only
  instruments with real prices (or prices derived from a real series, e.g. Treasury
  bond prices from real yields); the rest are hidden, and appear as soon as a
  provider covers them. The top-bar chip reads "Real data".
- **Calendars** keep only events from the data desk and the daily syncs, and
  earnings dates from the fundamentals provider.

So that nothing is empty, the scheduled syncs need to run (Vercel Cron, with the
provider keys set); before the first market sync the public pages say that no
real prices have loaded yet.

## African markets

`GET /api/cron/africa-sync` (daily 17:10 UTC, after the NGX close; `npm run africa:sync`) uses the parts of
the four African APIs that the price and fundamentals syncs don't. Disclosures, news and events are written
as data-desk documents (`gen: 'africa-sync'`), so they appear with their source wherever desk content does,
and documents you entered yourself are never changed.

| Source | Key | What it adds | Where it shows |
|---|---|---|---|
| NGX Pulse, else Mansa | `NGX_PULSE_API_KEY` / `MANSA_API_KEY` | NGX All-Share, market cap, volume, value, deals, breadth, session status | Movers › Nigerian Exchange (`afr/ngx`) |
| Mansa, else the full NGX list | `MANSA_API_KEY` | Top gainers and decliners; most active by volume | Movers |
| Mansa | `MANSA_API_KEY` | Pan-African movers, NGX ETFs | Movers |
| NGX Pulse | `NGX_PULSE_API_KEY` | NASD OTC securities | Movers |
| MyStocks Africa | `MYSTOCKS_AFRICA_API_KEY` | Market intelligence (commentary, sector moves) | Movers |
| NGX Pulse, Mansa | either | NGX corporate disclosures, last 90 days, linked to the listing | Market news, Country data, security pages (`adm_news/auto-ngxd-*`) |
| MyStocks Africa | `MYSTOCKS_AFRICA_API_KEY` | Company news for NGX listings, 10 listings a run in rotation (`AFRICA_NEWS_BUDGET`) | Market news, security pages (`adm_news/auto-msn-*`) |
| Mansa | `MANSA_API_KEY` | NGX dividends: qualification and payment dates, 15 listings a run in rotation (`AFRICA_DIV_BUDGET`) | Calendar (`adm_cal/auto-ngxdiv-*`) |
| Africa API | `AFRICA_API_KEY` | Upcoming elections in African countries | Calendar, Country data (`adm_cal/auto-elec-*`) |

Country data also shows a profile, trade overview and upcoming elections for African countries, read live
from Africa API through `GET /api/africa/country/<CC>` (signed-in users; cached for six hours).
The responses of these APIs are not all documented, so fields are found by their common names; check
the first dry run (`npm run africa:sync -- --dry-run`, or the "Data dry run" workflow) against real responses.

## Macro data, calendars and private placements

`GET /api/cron/macro-sync` (daily 05:20 UTC; the official rate feeds and CFTC run separately at
05:50 UTC as `?group=rates`, so each run stays inside the time limit; `npm run macro:sync` runs both) writes into
the data desk's own collections, so everything appears with its source and the
app treats it like Data studio content. It never changes documents you entered
yourself, and a series only feeds the macro panels when you haven't supplied
that indicator for that country.

| Source | Key | What it adds | Where it shows |
|---|---|---|---|
| World Bank | none | 10 annual indicators for ~105 countries (GDP growth, GDP, GDP per head, inflation, unemployment, current account, exports, FDI, government debt, population) | Country data |
| BIS | none | Central-bank policy rates, ~40 countries, monthly | Country data, macro panels (policy rate) |
| ECB | none | Euro-area HICP inflation and deposit rate | Country data, macro panels |
| OECD | none | Monthly CPI inflation, ~37 economies. Asked in batches of 8 areas (wide queries time out when OECD is busy; 60 downloads an hour); EU members also from the COICOP-2018 dataflow, whose values win (their COICOP-1999 series stop at 2025-12) | Country data, macro panels (CPI) |
| BIS | none | Monthly CPI inflation, ~64 economies (feeds the CPI panel where OECD doesn't) | Country data, macro panels |
| World Bank Pink Sheet | none | Read from the monthly workbook `CMO-Historical-Data-Monthly.xlsx` (found on the commodity-markets page; the API no longer serves it). Monthly averages for TTF gas (converted to EUR/MWh), Japan LNG, Australian coal, aluminium, nickel, zinc, iron ore, palm oil, urea, DAP | Commodities (those instruments are renamed "monthly average") |
| SMARD (Bundesnetzagentur) | none | German day-ahead power price, daily average | Commodities (German power) |
| Eurostat, BLS (ICS) | none (BLS: `SEC_USER_AGENT`) | Eurostat headline data releases (`/o/calendars/eventsIcal`) and U.S. labour-statistics release dates. BLS blocks robots without a contact address, so it is only asked when `SEC_USER_AGENT` holds one | Market calendars |
| EIA | `EIA_API_KEY` (free) | U.S. crude, gasoline, distillate inventories and gas storage, weekly | Country data (United States) |
| FRED | `FRED_API_KEY` | U.S. release dates (CPI, payrolls, GDP, PCE …), next 45 days | Market calendars |
| U.S. Treasury FiscalData | none | Upcoming Treasury auctions | Market calendars |
| FMP, else EODHD | `FMP_API_KEY` / `EODHD_API_KEY` | Economic calendar with consensus and actuals; IPOs | Market calendars |
| FMP, else EODHD | `FMP_API_KEY` / `EODHD_API_KEY` | Ex-dividend dates for the tracked U.S. stocks and ETFs | Market calendars |
| EODHD | `EODHD_API_KEY` | Stock splits (and reverse splits) for the tracked U.S. stocks and ETFs, next 90 days | Market calendars ("Stock split") |
| SEC EDGAR (Form D) | `SEC_USER_AGENT` ("Company contact@domain"; skipped without it) | U.S. private placements: issuer, sector, state, year founded, amount raised, related persons. Pooled funds (venture, private equity, hedge): type, amount offered and sold, investors, minimum | Private companies, Deal flow; Fund performance › **Funds raising now** |
| U.S. Treasury | none | Daily par yield curve: 3M, 1Y, 2Y, 5Y, 10Y, 30Y (public domain) | U.S. yields (DESK prices) |
| New York Fed | none | SOFR (instrument) and EFFR (series); credit line "Content from the New York Fed…" kept in the notes | Money markets, Country data |
| Bank of England | none | SONIA (series), 5Y and 10Y nominal par gilt yields (Open Government Licence) | UK yields, Country data |
| Bank of Canada | none | Benchmark bond yields 2Y, 5Y, 10Y, long (as 30Y); CORRA | Canada yields, Country data |
| ECB | none | €STR, daily | Country data (euro area) |
| CFTC Commitments of Traders | none | Weekly speculative net positions (non-commercial long minus short) in crude, gas, gold, silver, copper, grains, softs, S&P 500, 10Y note, euro, yen (public domain) | Country data (United States) |

Form D is read from EDGAR's daily index (new filings only, not amendments) within
a request budget (`FORMD_BUDGET`, default 250 a run), resuming where the last run
stopped. SEC asks for a contact address in the User-Agent and answers 403 without one (or above
10 requests a second); on a 403 the run stops for the day and resumes from the same filing next
time. Company raises under `FORMD_MIN_SOLD` (US$1m) are skipped; issuers with no filing for a year
are retired, and the newest 500 kept. Pooled funds (not registered '40 Act funds) go to a separate
"funds raising" list (`adm_priv/secf-<cik>`, kind `raise`), newest 1,500, shown on Fund performance
apart from the performance table, because Form D has no IRR, TVPI or DPI.
The FMP and EODHD calendars depend on your plans; if an endpoint is not included,
the run reports it and the other sources still update.

Price series for instruments are written to `adm_inst/<instrument id>` and shown as DESK prices;
in real-data mode an instrument's history starts at its first real price (no modelled history, no
simulated volumes).

Deliberately left out: IMF data (commercial reuse needs written permission),
scraped sites (TradingEconomics, Investing.com) and proprietary series (PMIs,
Baltic Dry, JKM). Nigerian T-bill, interbank and FMDQ rates have no free licensed
source. FRED's API terms prohibit storing FRED data and passing it on: U.S. Treasury yields and
SOFR now come from the Treasury and the New York Fed instead. The market sync still stores some FRED
series (credit spreads, volatility indices, FX fallbacks, U.S. CPI and payrolls), which should move to
the producing agencies (BLS, BEA, Cboe via a licensed provider) or be licensed. The source research,
with licences and ranked plans, is in `docs/data-sources-research.md` and
`docs/data-sources-deeper-sweep.md` (second, deeper sweep: rates, Africa, energy, private markets,
filings, national statistics, X).

## CI and monitoring (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| **CI** (`ci.yml`) | Every push to `main` and every PR | `npm ci`, route types, lint, typecheck, tests, build. No secrets needed: tests use mocked APIs |
| **Data dry run** (`data-dry-run.yml`) | By hand (Actions → Run workflow), or when the workflow file changes | Checks every provider key, then runs the market, news, fundamentals and macro syncs with `--dry-run` against the real APIs using the repository secrets. Reads the database, writes nothing; budgets are kept small. Results appear in the run summary |
| **Sync health** (`sync-health.yml`) | Daily 09:17 UTC, or by hand | Fails if a sync is stale (prices > 80 h, news > 26 h, fundamentals > 26 h, macro data > 50 h) or its last run produced no data. GitHub emails the repository owner about failed scheduled runs |

The dry run and health check need the `DATABASE_URL` repository secret (already
set); the dry run also uses the provider secrets.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Row-level security tests (in-memory Postgres) and database-shim tests |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run seed` | Load `supabase/seed-data` into Supabase |
| `npm run providers:check` | Ping every configured data connection |
| `npm run market:sync` | Pull end-of-day prices from the providers into the app (`-- --dry-run` to preview) |
| `npm run news:sync` | Pull recent headlines from the news providers (`-- --dry-run` to preview) |
| `npm run fundamentals:sync` | Refresh reported financials (`-- --dry-run`, `-- --budget=64`) |
| `npm run macro:sync` | Pull macro data, official rates, calendars and Form D filings (`-- --dry-run`, `-- --only=bis,ecb`, `-- --group=rates`) |
| `npm run africa:sync` | Pull the NGX snapshot, disclosures, company news, dividends and elections (`-- --dry-run`, `-- --only=disclosures,elections`) |
| `npm run sync:health` | Check that each sync ran recently and produced data (exit 1 if not) |
