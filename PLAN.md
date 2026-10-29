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

- Move each user's workspace (watchlists, notes, alerts, graphs, which are still
  in `localStorage` under `sf.ws.<email>`) into `data/users/<id>/…` documents.
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
- ✅ UK company register page and main-search results (Companies House).

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
  Still to do: show each sync's last run on the Data sources page.
- ✅ **Live dry run**: the "Data dry run" workflow runs the syncs against the real APIs.

## Remaining: data still simulated

- **Instruments with no source (27).** EM sovereign spread, TED spread, Nigerian T-bills
  (3M, 6M, 1Y) and money-market rates (OPR, overnight, MPR), commodities (TTF, JKM,
  Newcastle coal, uranium, aluminium, nickel, zinc, iron ore, lithium, palm oil,
  urea, DAP, EU carbon, German power, Baltic dry, TD3C, BCOM), ISM and China PMIs.
  Some may be on paid EODHD/FMP plans; NGX rates could come from FMDQ/CBN.
- **Volumes and intraday ranges.** Prices are real end-of-day closes; volumes,
  open/high/low and intraday charts are simulated. EODHD/Marketstack carry
  OHLCV and intraday bars.
- **Economic data beyond the U.S.** The Country data / macro panels (19 countries),
  the economic-release calendar (consensus and actuals), central-bank meetings,
  Treasury auctions, dividends and AGMs are simulated. Candidates: FRED/OECD, the
  Africa API (indicators, elections), EODHD macro and calendars (dividends, splits, IPOs).
- **Earnings beyond U.S. large caps.** The earnings calendar covers the 64 U.S. names;
  guidance, filings (SEC EDGAR) and earnings-release links are not connected.
- **Market intelligence.** Briefs, insights and the regime model run on prices;
  headlines are attached as possible catalysts, but causes stay unconfirmed.
- **Private markets.** Companies, deals, funds and cap tables are fictional except data-desk
  entries. No provider in the current set covers private rounds.
- **Not connected anywhere** (labelled in the app): options and implied volatility, OIS and
  policy pricing, credit ratings and CDS, FX forwards/NDFs and cross-currency basis,
  inflation swaps, IMF/BIS data, recession dating, positioning, shipping and energy
  fundamentals.

## Remaining: connected but unused

- EODHD: intraday and real-time bars, news, dividends/splits/IPO calendars, macro indicators.
- Alpha Vantage: news sentiment, technical indicators.
- NGX Pulse: corporate disclosures, NASD OTC securities.
- Mansa API: movers, ETFs, dividends, disclosures.
- MyStocks Africa: news and market intelligence.
- Africa API: country indicators, elections, trade and policy data (fits Country data).
- Companies House: officer search; a company-number column in the data-desk import template.
- The Data sources page and landing page still describe providers as "planned" or "server only";
  they should read their status from `/api/providers`.
