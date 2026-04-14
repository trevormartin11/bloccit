# FlipCRM

A property-pipeline CRM for real-estate investors. Static SPA — works on GitHub
Pages for free, upgrades to Netlify for automatic MLS data and nightly sold-price
syncs.

**Live demo:** https://trevormartin11.github.io/bloccit/

## Features

- **Dashboard** — KPI tiles (Properties, Hot Leads, Pipeline ARV, Potential
  Profit, Closed Sold), pipeline-by-stage funnel chart, recent activity feed.
- **Pipeline (Kanban)** — drag properties between columns to change status.
- **Properties (Table)** — sortable, searchable, filterable, CSV export.
- **Deal math** — Asking, ARV, **Rehab Estimate**, **Max Offer**, **Sold Price**,
  auto-calculated **Potential Profit** (`ARV − Offer − Rehab − 10% holding`).
- **MLS / Zillow Import** — paste a listing URL or an address; the serverless
  function pulls beds/baths/sqft/year/owner/AVM via RentCast.
- **Nightly Sold-Price sync** — Netlify scheduled function runs at 07:00 UTC,
  checks each active listing, and marks sold when a recent sale is detected.
  Also exposed as a manual "Check Sold Prices" button.
- **Team sync (optional)** — point the app at a free Supabase project and your
  partner's browser sees the same deal list in real time.
- **Local-first** — works with no backend at all; your data lives in `localStorage`
  until you opt in to Supabase sync.

## File layout

```
index.html                       Main SPA shell (sidebar + topbar + views)
styles.css                       Design system
js/app.js                        UI controller
js/storage.js                    Pluggable store (local + optional remote)
js/supabase.js                   Optional Supabase sync adapter
js/mls.js                        MLS import client (with URL-parse fallback)
netlify/functions/mls-import.js  RentCast-backed import endpoint
netlify/functions/check-sold.js  Nightly + on-demand sold-price check
netlify.toml                     Deploy & schedule config
supabase-schema.sql              One-click SQL to enable team sync
tests/test.html                  Browser-based unit tests
```

## Deploying

### Easiest: GitHub Pages (free, no signup)

1. Repo → **Settings → Pages**
2. Source: *Deploy from a branch*, choose your branch, folder `/ (root)`
3. Wait ~60s. Live at `https://<user>.github.io/<repo>/`.

On GitHub Pages the serverless functions don't run, so:
- MLS Import falls back to extracting the address from the URL
- "Check Sold Prices" shows an error toast
- A yellow banner explains this at the top of the page

Everything else works — it's still a fully usable CRM.

### Full experience: Netlify (free tier, 2-click GitHub login)

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import from Git**
2. Pick this repo. Build settings are auto-detected from `netlify.toml`.
3. **Site settings → Environment variables → Add**:
   - `RENTCAST_API_KEY` → sign up at <https://www.rentcast.io/api>
4. Trigger a redeploy. MLS Import and nightly sold-price sync are now live.

## Team sync (Supabase)

By default each browser has its own private property list. To share a pipeline
with your partner:

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL editor → New query → paste the contents of [`supabase-schema.sql`](./supabase-schema.sql) → Run.
3. Settings → API → copy **Project URL** and **anon public key**.
4. In FlipCRM: **Settings → Team sync** → paste both → *Save & connect*.
5. Repeat step 4 on your partner's device. Both now see the same data.

The app still works offline — changes sync on reconnect.

## Alternative MLS data providers

`netlify/functions/mls-import.js` is written against RentCast (best developer
experience for solo investors). Swap `lookupRentcast()` if you'd rather use:

- **ATTOM Data Solutions** — enterprise-grade property + AVM.
- **Estated / Spyglass** — address-level property detail.
- **BatchData / PropStream** — investor-focused, includes owner contact info.
- **Direct MLS (RESO Web API)** — highest fidelity, requires agent license.

## Tests

Open `/tests/test.html` in the browser. Covers the deal math (70% rule,
potential profit) and the store's add/update/remove/export round-trip.

## Local development

```bash
# Plain static — just double-click index.html, or:
python3 -m http.server 8000

# With Netlify functions:
npm install -g netlify-cli
netlify dev     # http://localhost:8888
```

## Roadmap / not yet built

- Document attachments (Google Drive links in the original; deliberately omitted
  to keep the footprint small — data model already has a `documents` slot if
  you want to add it).
- Offer-history timeline & full contact log (schema supports it; just UI).
- Email / SMS reminders for Follow-Up properties.
- Per-user auth + team separation on the Supabase side. The current schema uses
  an open-access policy fine for a two-person team — tighten it up if you invite
  more people.
