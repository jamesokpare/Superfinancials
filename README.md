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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Row-level security tests (in-memory Postgres) and database-shim tests |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run seed` | Load `supabase/seed-data` into Supabase |
