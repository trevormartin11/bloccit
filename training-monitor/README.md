# HK USA Training Monitor

Automatically watches the [HK USA training schedule](https://training.hk-usa.com/courses/)
and emails **trevormartin11@gmail.com** whenever new training dates/events are
added.

## How it works

- A GitHub Actions workflow (`.github/workflows/training-monitor.yml`) runs the
  monitor **four times a day in US Eastern Time — 9:00 AM, 12:00 PM, 3:00 PM,
  and 6:00 PM**.
- The schedule moved from a static page on `hk-usa.com` to a WooCommerce store
  on `training.hk-usa.com`, so `monitor.py` reads the courses from the public
  **WooCommerce Store API**
  (`/wp-json/wc/store/v1/products`) — structured JSON, much more robust than
  HTML scraping. Each dated product (e.g. `SP5 Armorer Course: 8 July 2026`) is
  an event; a trailing `(SOLD OUT)` status is ignored so a sell-out isn't
  treated as a new event. The list is compared to `last_seen.json`.
- If any **new** events appear, it emails them. If nothing changed, it stays
  silent (no inbox spam).
- The updated `last_seen.json` is committed back to the repo after each run so
  the next run knows what was already seen.

> GitHub's cron runs in UTC and ignores daylight saving, so the workflow
> schedules both the EDT and EST UTC times and the script only acts during the
> four target Eastern hours — giving exactly four runs/day year-round.

## One-time setup (required to send email)

The workflow needs SMTP credentials to send mail. Using a Gmail
**App Password** is easiest:

1. Enable 2-Step Verification on the Google account, then create an
   **App Password**: <https://myaccount.google.com/apppasswords>
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions →
   New repository secret** and add:

   | Secret name     | Value                                              |
   |-----------------|----------------------------------------------------|
   | `MAIL_USERNAME` | the Gmail address used to send (e.g. your Gmail)   |
   | `MAIL_PASSWORD` | the 16-character Google App Password               |
   | `MAIL_TO`       | *(optional)* recipient; defaults to trevormartin11@gmail.com |
   | `MAIL_FROM`     | *(optional)* From address; defaults to `MAIL_USERNAME` |

3. Done. The schedule is already active once this is merged to the default
   branch. (Scheduled workflows only run from the default branch.)

### Using a non-Gmail SMTP provider

Set repo **variables/secrets** `SMTP_HOST` and `SMTP_PORT` via the workflow env
if you prefer another provider. Port `465` uses SSL; any other port uses
STARTTLS.

## Manual test

From the repo's **Actions** tab, pick **HK USA Training Monitor → Run
workflow** (the `force_run` input defaults to true, so it ignores the time
window). You can also run locally:

```bash
MAIL_USERNAME=you@gmail.com MAIL_PASSWORD=app-password FORCE_RUN=1 \
  python3 training-monitor/monitor.py
```

## Resetting / re-seeding

Delete or empty `last_seen.json` and run once — the first run seeds state
without emailing, so you won't get a flood of "new" events for the existing
schedule.
