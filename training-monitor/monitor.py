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

import html as ihtml
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None

URL = "https://hk-usa.com/training/"
STATE_FILE = Path(__file__).resolve().parent / "last_seen.json"
USER_AGENT = "Mozilla/5.0 (compatible; hk-training-monitor/1.0)"

# An "event" line looks like: "8 July 2026: SP5 Armorer Course ($350)"
EVENT_RE = re.compile(r"^\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}\s*:\s*.+")

# Eastern-time hours at which we actually want to act (9am, 12pm, 3pm, 6pm).
TARGET_ET_HOURS = {9, 12, 15, 18}


def fetch_html(url: str = URL) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_events(html: str) -> list[str]:
    """Return the ordered, de-duplicated list of training event lines."""
    no_scripts = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html,
                        flags=re.S | re.I)
    text = ihtml.unescape(re.sub(r"<[^>]+>", "\n", no_scripts))
    events: list[str] = []
    for raw in text.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if EVENT_RE.match(line):
            line = re.sub(r"[\s–—\-]+$", "", line).strip()
            if line and line not in events:
                events.append(line)
    return events


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
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ["MAIL_USERNAME"]
    password = os.environ["MAIL_PASSWORD"]
    sender = os.environ.get("MAIL_FROM", user)
    recipient = os.environ.get("MAIL_TO", "trevormartin11@gmail.com")

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

    print(f"Sent notification to {recipient} for {count} new event(s).")


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

    try:
        html = fetch_html()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: failed to fetch {URL}: {exc}", file=sys.stderr)
        return 1

    current = extract_events(html)
    if not current:
        print("ERROR: no events parsed — page layout may have changed. "
              "Leaving state untouched.", file=sys.stderr)
        return 1

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
