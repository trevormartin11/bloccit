#!/usr/bin/env python3
"""
HK USA training-schedule monitor.

Fetches https://hk-usa.com/training/, extracts the list of scheduled
training events, compares them against the last-known set, and emails any
NEWLY ADDED events. State is kept in ``last_seen.json`` next to this file,
which the workflow commits back to the repo after each run.

The script is intentionally dependency-free (Python standard library only)
so the GitHub Actions workflow needs no `pip install` step.
"""

from __future__ import annotations

import gzip
import html as ihtml
import json
import os
import re
import smtplib
import ssl
import sys
import time
import urllib.request
import zlib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None

# The training schedule moved from a static page on hk-usa.com to a
# WooCommerce store on training.hk-usa.com. Each course/date is now a product,
# exposed as clean structured JSON by the public WooCommerce Store API — far
# more robust than scraping HTML. URL is the human-facing page used in emails.
URL = "https://training.hk-usa.com/courses/"
API_URL = ("https://training.hk-usa.com/wp-json/wc/store/v1/products"
           "?per_page=100")
STATE_FILE = Path(__file__).resolve().parent / "last_seen.json"
# Browser-like UA + headers: the site/CDN intermittently serves a bot
# challenge or compressed body to generic clients, which yields zero parsed
# events. Looking like a normal browser makes that far less likely.
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}
FETCH_ATTEMPTS = 4

# A product name looks like: "SP5 Armorer Course: 8 July 2026 (SOLD OUT)".
# Treat any product whose name contains a date as a schedule event.
DATE_RE = re.compile(r"\b\d{1,2}\s+[A-Za-z]{3,9}\.?\s+20\d\d\b")
# Strip a trailing "(... sold out ...)" status so a course selling out doesn't
# look like a brand-new event.
SOLDOUT_RE = re.compile(r"\s*\([^)]*sold\s*out[^)]*\)\s*$", re.I)

# Eastern-time hours at which we actually want to act (9am, 12pm, 3pm, 6pm).
TARGET_ET_HOURS = {9, 12, 15, 18}


def fetch_json(url: str = API_URL):
    req = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
        encoding = (resp.headers.get("Content-Encoding") or "").lower()
    if "gzip" in encoding:
        raw = gzip.decompress(raw)
    elif "deflate" in encoding:
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    return json.loads(raw.decode("utf-8", errors="replace"))


def extract_events(products) -> list[str]:
    """Return the ordered, de-duplicated list of dated course names.

    ``products`` is the list returned by the WooCommerce Store API. Only
    products whose name contains a date are treated as schedule events, and
    a trailing "(sold out)" status is stripped so a sell-out isn't mistaken
    for a newly added event.
    """
    events: list[str] = []
    for product in products if isinstance(products, list) else []:
        name = re.sub(r"\s+", " ", (product.get("name") or "")).strip()
        if not DATE_RE.search(name):
            continue
        name = SOLDOUT_RE.sub("", name).strip()
        if name and name not in events:
            events.append(name)
    return events


def fetch_events_with_retry() -> list[str] | None:
    """Fetch and parse, retrying transient failures and empty results.

    The endpoint can occasionally return a transient error or an empty/partial
    body. Retrying with backoff resolves nearly all of these. Returns the
    parsed events, or None if every attempt yielded zero events (ambiguous —
    caller decides what to do).
    """
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            events = extract_events(fetch_json())
        except Exception as exc:  # noqa: BLE001
            print(f"Fetch attempt {attempt}/{FETCH_ATTEMPTS} failed: {exc}",
                  file=sys.stderr)
            events = []
        if events:
            return events
        if attempt < FETCH_ATTEMPTS:
            time.sleep(2 ** attempt)  # 2s, 4s, 8s
    return None


def load_state() -> list[str]:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return list(data.get("events", []))
            if isinstance(data, list):
                return list(data)
        except (json.JSONDecodeError, OSError):
            pass
    return []


def save_state(events: list[str]) -> None:
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": URL,
        "events": events,
    }
    STATE_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def send_email(new_events: list[str], test: bool = False) -> None:
    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or "465")
    user = os.environ["MAIL_USERNAME"]
    password = os.environ["MAIL_PASSWORD"]
    # Use `or` (not get-default) so an empty env var — which the workflow
    # always sets when the optional secret is absent — falls back correctly.
    sender = os.environ.get("MAIL_FROM") or user
    recipient = os.environ.get("MAIL_TO") or "trevormartin11@gmail.com"

    if test:
        subject = "[HK USA Training] Test email - monitor is working"
        text_body = (
            "This is a test email from your HK USA training monitor.\n\n"
            "If you're reading this, email alerts are configured correctly and "
            "you'll be notified here whenever new training events are added to:\n"
            f"{URL}\n\n"
            "(No real new events are reported in this message — it's only a "
            "delivery test.)\n\n"
            "— Automated monitor"
        )
        html_body = (
            "<p>✅ <strong>This is a test email</strong> from your HK USA "
            "training monitor.</p>"
            "<p>If you're reading this, email alerts are configured correctly "
            "and you'll be notified here whenever new training events are added "
            f'to <a href="{URL}">the schedule</a>.</p>'
            "<p style=\"color:#888\">(No real new events are reported in this "
            "message — it's only a delivery test.)<br>— Automated monitor</p>"
        )
    else:
        count = len(new_events)
        subject = f"[HK USA Training] {count} new training " \
                  f"event{'s' if count != 1 else ''} added"

        bullet_txt = "\n".join(f"  • {e}" for e in new_events)
        text_body = (
            f"{count} new training event{'s' if count != 1 else ''} were found "
            f"on the HK USA training schedule:\n\n"
            f"{bullet_txt}\n\n"
            f"View the full schedule: {URL}\n\n"
            f"— Automated monitor"
        )

        bullet_html = "".join(f"<li>{ihtml.escape(e)}</li>" for e in new_events)
        html_body = (
            f"<p><strong>{count} new training "
            f"event{'s' if count != 1 else ''}</strong> "
            f"found on the HK USA training schedule:</p>"
            f"<ul>{bullet_html}</ul>"
            f'<p><a href="{URL}">View the full schedule &rarr;</a></p>'
            f"<p style=\"color:#888\">— Automated monitor</p>"
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=45) as s:
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=45) as s:
            s.starttls(context=context)
            s.login(user, password)
            s.send_message(msg)

    if test:
        print(f"Sent test email to {recipient}.")
    else:
        print(f"Sent notification to {recipient} for {len(new_events)} "
              f"new event(s).")


def within_target_window() -> bool:
    """True if this run should act (manual runs always act)."""
    if os.environ.get("FORCE_RUN") == "1":
        return True
    if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        return True
    if ZoneInfo is None:
        return True  # cannot determine TZ; fail open
    now_et = datetime.now(ZoneInfo("America/New_York"))
    return now_et.hour in TARGET_ET_HOURS


def main() -> int:
    if os.environ.get("SEND_TEST_EMAIL") == "1":
        print("Test mode: sending a verification email…")
        try:
            send_email([], test=True)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: failed to send test email: {exc}", file=sys.stderr)
            return 1
        print("Test email sent.")
        return 0

    if not within_target_window():
        now_et = datetime.now(ZoneInfo("America/New_York"))
        print(f"Skipping: {now_et:%H:%M} ET is outside target hours "
              f"{sorted(TARGET_ET_HOURS)}.")
        return 0

    current = fetch_events_with_retry()
    if not current:
        # Every attempt returned zero events. This is almost always a
        # transient bot-challenge/partial response rather than a real layout
        # change, so exit 0 (leave state untouched) to avoid spamming the
        # repo owner with GitHub "workflow failed" emails on every check.
        # A genuine layout change shows up as repeated warnings in the logs.
        print(f"WARNING: no events parsed from {URL} after "
              f"{FETCH_ATTEMPTS} attempts; leaving state untouched and "
              f"skipping this run.", file=sys.stderr)
        return 0

    previous = load_state()
    first_run = not STATE_FILE.exists()

    previous_set = set(previous)
    new_events = [e for e in current if e not in previous_set]

    print(f"Parsed {len(current)} event(s); {len(new_events)} new.")

    if new_events and not first_run:
        try:
            send_email(new_events)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: failed to send email: {exc}", file=sys.stderr)
            return 1
    elif new_events and first_run:
        print("First run — seeding state without emailing.")
    else:
        print("No new events; nothing to send.")

    save_state(current)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
