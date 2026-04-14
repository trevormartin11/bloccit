# FlipCRM

A lightweight property-pipeline CRM for real-estate investors. Built to be
deployed on Netlify as a pure static site with two serverless functions.

## Features

- **Property pipeline** with statuses (New / Cold / Warm / Hot / Follow Up /
  Under Contract / Sold / Archived).
- **Deal math**: Asking Price, ARV, **Rehab Estimate**, **Max Offer**,
  auto-calculated **Potential Profit**, plus a one-click **70% Rule** helper
  (`Max Offer = ARV × 0.70 − Rehab`).
- **MLS Import** button — paste a Zillow / Redfin / Realtor.com URL *or* a
  raw address, and the form is auto-populated via the RentCast API.
- **Nightly Sold-Price check** — a Netlify scheduled function runs every day
  at 07:00 UTC, looks up each active property, and marks it "Sold" with the
  closing price when a recent sale is detected. Also exposed as a manual
  "Check Sold Prices" button.
- **KPI dashboard**: properties, hot leads, pipeline ARV, potential profit,
  and closed deals.
- **Search, filter, sort, CSV export**, keyboard shortcuts (Esc closes modals).
- **Local-first**: data is stored in browser `localStorage` — no signup, no
  backend database required.

## File layout

```
index.html                       Main single-page UI
styles.css                       Design system
js/app.js                        UI controller
js/storage.js                    localStorage wrapper
js/mls.js                        Client-side import helper
netlify/functions/mls-import.js  MLS/Zillow → form-field normalizer
netlify/functions/check-sold.js  Nightly + on-demand sold-price check
netlify.toml                     Deploy & schedule config
```

## Deploying

1. Push this branch to GitHub.
2. In Netlify: **Add new site → Import from Git** → pick this repo.
3. Netlify auto-detects `netlify.toml`. No build command needed.
4. **Set environment variables** (Site settings → Environment variables):
   - `RENTCAST_API_KEY` — sign up at <https://www.rentcast.io/api> (free tier
     covers ~50 lookups/mo; paid tiers start at $49/mo for 1,000 lookups).
5. The scheduled `check-sold` function will automatically run nightly at 07:00 UTC.

Without `RENTCAST_API_KEY` the site still works — MLS Import falls back to
just extracting the address from the URL, and the sold-price check is a no-op.

## Alternative data providers

`netlify/functions/mls-import.js` is written against RentCast, but any of the
following work with minor tweaks to `lookupRentcast()`:

- **ATTOM Data Solutions** — broad property + AVM coverage, enterprise pricing.
- **Estated / Spyglass** — address-level property detail.
- **BatchData / PropStream** — investor-focused, includes owner contact info.
- **Direct MLS (RESO Web API)** — requires an agent license + broker approval
  in your market. Highest fidelity; not practical for most individual users.

## Not included (but easy to add later)

- User accounts / multi-user collaboration (would need a real backend — e.g.
  Supabase, Convex, or Netlify Blobs + Auth).
- Document uploads (the original app used Google Drive links; current version
  keeps notes-only to stay lightweight).
- Offer-history timeline & contact log (the data model supports it; just needs
  UI tabs).
- Email/SMS reminders for "Follow Up" properties.

## Local development

```bash
npm install -g netlify-cli   # one-time
netlify dev                  # serves static + functions on http://localhost:8888
```
