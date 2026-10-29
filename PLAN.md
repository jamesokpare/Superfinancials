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
- ✅ Real end-of-day prices from the provider APIs flow into the existing `Provider` layer (`src/lib/market/`, daily cron).
- ✅ Provider headlines on Market news, briefs and security pages (`src/lib/news/`, `public/legacy/news-feed.js`).
- ✅ Reported fundamentals for U.S. equities (`src/lib/fundamentals/`, `public/legacy/fundamentals.js`).
- ✅ Reported earnings and consensus estimates (`public/legacy/earnings.js`).
- Next for data: load history per instrument on demand instead of the whole `mkt` collection; NGX company fundamentals; UK company data (Companies House) for the pages that still say "no provider connected".
- Deploy to Vercel; Supabase migrations from CI.
