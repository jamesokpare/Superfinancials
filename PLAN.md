# Migration plan: artifact → Next.js + Supabase

The original Superfinancials artifact is one HTML page: ~9,300 lines of
vanilla JavaScript, ~1,800 lines of CSS, 57 pages, a seeded market-data
simulator, hand-built SVG charts and 7 interface languages. It relied on the
claude.ai artifact runtime for its database, sign-in, presence, file uploads
and AI.

We move it in stages so the app keeps working at every step.

## Phase 0–1: running in Next.js ✅ (this branch)

- Next.js 16 (App Router, TypeScript).
- The original script, styles and markup run unchanged from `public/legacy/`.
- `window.claude.use()` is rebuilt on Supabase (`src/lib/claude-shim/`), so the
  cloud features work: sign-in, organizations, network feed, messages,
  shares, live prices, Studio content, file uploads.
- Supabase schema with row-level security that mirrors the artifact's rules;
  seed data exported from the artifact's database.
- `/login` (password, sign-up, email link) and `/api/ai` (Claude, server-side key).

## Phase 2: backend hardening

- ✅ Each signed-in user's workspace is saved in `data/users/<id>/workspace` and follows them across
  devices (`public/legacy/workspace.js`); the browser copy is a cache. Still local: the security event
  log (`sf.audit.<profile>`) and local profiles, which have no account.
- Enforce plan limits and AI access on the server (today the client checks them).
- Rate-limit `/api/ai`; log usage per user.
- Cookie-based Supabase sessions (`@supabase/ssr`) so server components can
  read the user, which Phase 3 pages will need.
- Replace the generic `docs` table with typed tables where it pays off
  (posts, messages, orgs) once those features are ported.

## Phase 3: port to React, page by page

- App shell first: sidebar, top bar, search, modals, toasts.
- Shared components: tables, segmented controls, chips, the SVG chart engine.
- Then pages in this order: overview, security page, watchlists/portfolio,
  screener, network, private markets, admin. Each gets a real URL
  (`/equity/[id]`, `/pco/[id]`) instead of a `#hash`.
- The simulator and analytics are plain logic; they move over as typed modules.
- Fonts move to `next/font`.
- Remove each ported page from the legacy script, until the script is gone.

## Phase 4: languages

- `next-intl` with the 7 existing dictionaries. Today a script rewrites visible
  text as it renders; that goes away as pages move to React.

## Phase 5: billing, data, deploy

- Stripe for seats (Trial, Public $90, Private $45, Full $135).
- Deploy to Vercel (preview builds run on every PR); Supabase migrations from CI.

## Data connections: done

- ✅ Provider clients for all 15 repository secrets (`src/lib/providers/`).
- ✅ Real end-of-day prices into the `Provider` layer (`src/lib/market/`, daily cron), for 259 of 291 instruments when every source has data.
- ✅ Price history loaded per instrument on demand (`mkthist/<id>`, `public/legacy/history.js`); browsers download ~11 KB of `mkt` instead of ~760 KB.
- ✅ Provider headlines on Market news, briefs and security pages (`src/lib/news/`).
- ✅ Reported fundamentals for U.S. equities and NGX listings (`src/lib/fundamentals/`).
- ✅ Reported earnings and consensus estimates (`public/legacy/earnings.js`).
- ✅ Company registry: UK (Companies House), global (GLEIF) and data-desk companies added in the Data studio, with main-search results.
- ✅ Real-data mode: no fictional private companies or funds, and no simulated-only instruments, outside the demo workspace.
- ✅ Second round of sources (see `docs/data-sources-research.md`): OECD CPI fix, BIS CPI, World Bank Pink Sheet and SMARD prices for commodities without a feed, Eurostat/BLS release calendars, EIA inventories, official press-release feeds in Market news, Norway and France in Company registry.
- ✅ Third round (see `docs/data-sources-deeper-sweep.md`): fixes for the five failing feeds (OECD batches and COICOP 2018, Pink Sheet workbook, new Eurostat calendar, contact User-Agent for SEC and BLS); official rates instead of FRED (Treasury curve, NY Fed SOFR/EFFR, BoE SONIA and gilts, BoC yields and CORRA, ECB €STR); CFTC positioning; Form D pooled funds as "Funds raising now"; startup and deal news feeds.
- ✅ EODHD stock splits and dividend fallback in the calendar; Alpha Vantage and EODHD news with sentiment; EODHD intraday bars and delayed quotes on security pages; Companies House officer search and appointments; a company-number column in the private-company import; live connection status and each sync's last run on the Data sources and landing pages.
- ✅ African markets (`src/lib/africa/`, daily cron): NGX session summary, movers, most active, pan-African movers, ETFs and NASD OTC securities on Movers; NGX corporate disclosures and company news in Market news; NGX dividends and African elections in the calendar; Africa API country profile and trade on Country data.
- ✅ Daily macro sync (`src/lib/macro/`): World Bank, BIS, ECB, OECD series; FRED, Treasury, FMP/EODHD economic, dividend and IPO calendars; SEC Form D private placements.

## Remaining: verify what is wired

Nothing has run against the live APIs yet; every integration is tested with
mocked responses.

- **First live runs.** With the keys in Vercel, run `market:sync`, `news:sync` and
  `fundamentals:sync` with `--dry-run`, then for real, and check the per-provider output.
- **African API field mapping.** NGX Pulse, Mansa, MyStocks Africa and Africa API
  responses are read by common field names (prices, NGX All-Share, key figures);
  confirm against real responses.
- **Free-plan limits.** FMP batch quotes, EODHD fundamentals and calendars may need
  paid plans; the syncs fall back, but coverage depends on the plans.
- ✅ **CI**: GitHub Actions runs lint, typecheck, tests and build on every PR.
- ✅ **Sync health**: a daily workflow fails (and emails) when a sync is stale or empty.
- ✅ **Live dry run**: the "Data dry run" workflow runs the syncs against the real APIs.

## Remaining: data still simulated

- **Instruments with no source (27).** EM sovereign spread, TED spread, Nigerian T-bills
  (3M, 6M, 1Y) and money-market rates (OPR, overnight, MPR), commodities (TTF, JKM,
  Newcastle coal, uranium, aluminium, nickel, zinc, iron ore, lithium, palm oil,
  urea, DAP, EU carbon, German power, Baltic dry, TD3C, BCOM), ISM and China PMIs.
  Some may be on paid EODHD/FMP plans; NGX rates could come from FMDQ/CBN.
- **Volumes and daily ranges: done for priced instruments.** The market sync stores real open, high, low and
  volume from EODHD, FMP, Marketstack and Alpha Vantage (and NGX volumes in the desk listings); the app uses
  them instead of a range built from the previous close. FX from ExchangeRate-API, FRED series and yields stay
  close-only. Older history gains OHLCV as instruments are backfilled again (new instruments get it at once).
- **Economic data beyond the U.S.** Now from World Bank, BIS, ECB and OECD (annual or
  monthly). Still missing: PMIs (proprietary), central-bank meeting dates (no API; a
  yearly hand-entered list in the Data studio is the practical route), AGMs, and
  consensus figures where the FMP/EODHD plan doesn't include the economic calendar.
- **Earnings beyond U.S. large caps.** The earnings calendar covers the 64 U.S. names;
  guidance, filings (SEC EDGAR) and earnings-release links are not connected.
- **Market intelligence.** Briefs, insights and the regime model run on prices;
  headlines are attached as possible catalysts, but causes stay unconfirmed.
- **Private markets.** Data-desk entries and U.S. Form D private placements (amount raised,
  no valuation). Still missing: priced rounds and valuations, fund performance, non-U.S.
  rounds (UK Companies House SH01 share-allotment filings are a candidate), operating KPIs.
- **Not connected anywhere** (labelled in the app): options and implied volatility, OIS and
  policy pricing, credit ratings and CDS, FX forwards/NDFs and cross-currency basis,
  inflation swaps, IMF/BIS data, recession dating, positioning, shipping and energy
  fundamentals.

## Remaining: connected but unused

Everything the connected APIs offer that fits the app is now wired. Left out on purpose:

- EODHD macro indicators: the same World Bank series the macro sync already reads.
- Alpha Vantage technical indicators: the app computes RSI, moving averages and the rest from the price series itself.
- Africa API country indicators: also World Bank data; its policy data has no place in the app yet.
