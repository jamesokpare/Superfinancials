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
| `public/legacy/superfinancials.js` | The original artifact script (≈9,300 lines), with three small patches marked "Next.js port" |
| `src/app/legacy.css` | The original artifact styles |
| `src/legacy/shell.ts` | The static app shell markup the script renders into |
| `src/components/LegacyApp.tsx` | Installs the runtime shim, then loads the script once |
| `src/lib/claude-shim/` | `window.claude.use()` rebuilt: `db` (Firestore-style API on a Supabase table), `user`, `room` (Realtime), `assets` (Storage), `downloads`, `sample` (AI) |
| `src/app/login/` | Sign in, sign up, email link |
| `src/app/api/ai/` | Server-side Claude call for `sample` |
| `src/lib/providers/` | Clients for the external market-data, news and economic APIs |
| `src/app/api/providers/` | Data-connection status and health check |
| `src/lib/market/` | Market sync: instrument → provider map, fetchers, writer |
| `src/app/api/cron/market-sync/` | Scheduled sync endpoint (Vercel Cron) |
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
- `data/users/<id>/…`: private to that user.

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

or, signed in, `GET /api/providers` (configured or not) and
`GET /api/providers?check=1` (pings each). Errors are `ProviderError` /
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
- `mkt/d-<date>`: that day's closes (`[close, change, date, source]` per instrument)
- `mkt/h-<id>@<source>`: daily history (FRED every week; metered providers
  backfill up to `MARKET_HISTORY_BUDGET` instruments per run)
- `mkt/_meta`: a one-line summary shown on the Sources panel
- `adm_inst/AD.NG.*`: today's NGX close appended to each desk listing

Day documents older than 35 days are folded into the history documents, so the
collection every browser loads stays small.

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
