"""Demo-day helper: one command for each thing we did by hand on rehearsal night.

    cd services/api
    python demo.py check                  # is everything ready? (never prints secret values)
    python demo.py reset-pilot            # bug back on the pilot repo's main + a fresh fix branch
    python demo.py start                  # backend + one app window (pick who you are on /session)
    python demo.py reset                  # inc_demo back to the 2:04 a.m. page (server must be running)

Order on demo day: check -> reset-pilot -> start -> (play Night) -> open the fix PR only now -> Morning.
The fix PR must be opened AFTER the incident's page, or PR verify refuses it (pr_too_old).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from config import API_DIR, REPO_ROOT, Settings

WEB_DIR = REPO_ROOT / "apps" / "web"
DEFAULT_PILOT = REPO_ROOT.parent / "shopnorth-checkout"
API = "http://127.0.0.1:8000"
BUG_LINE = 'tier = customer.profile["tier"]'
FIX_FUNCTION = '''def loyalty_percent(customer: Customer) -> int:
    """Loyalty members get a discount by tier. A missing or unknown tier (e.g. guests) gets 0%."""
    tier = customer.profile.get("tier")
    return LOYALTY_PERCENT.get(tier, 0)'''
BUG_FUNCTION = '''def loyalty_percent(customer: Customer) -> int:
    """Loyalty members get a discount by tier."""
    tier = customer.profile["tier"]
    return LOYALTY_PERCENT[tier]'''
GUEST_TEST = '''

def test_guest_checkout_pays_full_price():
    """Incident 2:04 a.m.: guests have no loyalty tier, and checkout raised KeyError: 'tier'."""
    guest = Customer("g1", guest=True)
    assert loyalty_percent(guest) == 0
    assert order_total(cart_for(guest)) == Decimal("33.90")  # 30.00 + 13% tax, no discount
'''


def say(ok: bool | None, text: str) -> None:
    print({True: "  OK  ", False: "  !!  ", None: "  ..  "}[ok] + text)


def git(pilot: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(pilot), *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result.stdout.strip()


# ---------- check ----------

def check(pilot: Path) -> int:
    settings = Settings.from_env()
    print("Settings (set/empty only, never values):")
    for name, value in (("INTERNAL_KEY", settings.internal_key), ("GITHUB_TOKEN", settings.github_token),
                        ("PILOT_REPOS", ",".join(settings.pilot_repos)), ("DATABASE_URL", settings.database_url),
                        ("AUTH0_DOMAIN (empty = demo mode)", settings.auth0_domain)):
        say(bool(value) or name.startswith("AUTH0"), f"{name}: {'set' if value else 'empty'}")
    if settings.database_url.startswith(("postgres://", "postgresql://")):
        try:
            import psycopg

            with psycopg.connect(settings.database_url, connect_timeout=8) as conn:
                conn.execute("select 1")
            say(True, "Tiger Data reachable")
        except Exception as exc:  # report, never print the URL
            say(False, f"Tiger Data NOT reachable ({type(exc).__name__}); the API would fall back to SQLite")
    for label, path in (("Jobs snapshot", settings.jobs_snapshot_path),
                        ("Next-fixes snapshot", settings.next_fixes_snapshot_path)):
        try:
            fetched = json.loads(path.read_text(encoding="utf-8")).get("fetched_at")
            say(True, f"{label}: fetched {fetched}")
        except (OSError, ValueError):
            say(False, f"{label}: missing (run python {'adzuna' if 'jobs' in label.lower() else 'oss'}.py)")
    if (pilot / ".git").exists():
        git(pilot, "fetch", "-q", "origin")
        has_bug = BUG_LINE in git(pilot, "show", "origin/main:checkout/pricing.py")
        say(has_bug, "Pilot repo main has the bug (ready for the Morning fix)" if has_bug
            else "Pilot repo main already has the fix: run python demo.py reset-pilot")
    else:
        say(False, f"Pilot repo not found at {pilot} (use --pilot)")
    for label, url in (("API", f"{API}/health"), ("App window", "http://127.0.0.1:3000/")):
        try:
            urllib.request.urlopen(url, timeout=3)
            say(True, f"{label} is running")
        except Exception:
            say(None, f"{label} not running (python demo.py start)")
    return 0


# ---------- reset-pilot ----------

def reset_pilot(pilot: Path, fix_branch: bool = True) -> int:
    if not (pilot / ".git").exists():
        raise SystemExit(f"Pilot repo not found at {pilot} (use --pilot)")
    if git(pilot, "status", "--porcelain"):
        raise SystemExit("The pilot repo has uncommitted changes; commit or discard them first.")
    git(pilot, "checkout", "-q", "main")
    git(pilot, "pull", "-q", "--ff-only")
    pricing = pilot / "checkout" / "pricing.py"
    if BUG_LINE not in pricing.read_text(encoding="utf-8"):
        # The newest merge on main whose changes touch pricing.py (a path filter would hide merges).
        merges = git(pilot, "log", "--merges", "--first-parent", "--format=%H", "main").split()
        merge = next((m for m in merges
                      if git(pilot, "diff", "--name-only", f"{m}^1", m, "--", "checkout/pricing.py")), "")
        if not merge:
            raise SystemExit("main has the fix but no merge commit to revert; fix it by hand.")
        git(pilot, "revert", "-m", "1", "--no-edit", merge)
        if BUG_LINE not in pricing.read_text(encoding="utf-8"):
            raise SystemExit("Reverting the last merge did not bring the bug back; check by hand.")
        git(pilot, "push", "-q", "origin", "main")
        say(True, f"Reverted {merge[:7]} and pushed: the bug is back on main")
    else:
        say(True, "main already has the bug")
    if not fix_branch:
        say(True, "No ready-made fix branch: the Morning engineer writes the fix in VS Code")
        return 0
    branch = f"fix/guest-checkout-{datetime.now(timezone.utc):%m%d-%H%M}"
    git(pilot, "checkout", "-q", "-b", branch)
    tests = pilot / "tests" / "test_pricing.py"
    tests.write_text(tests.read_text(encoding="utf-8").rstrip("\n") + "\n" + GUEST_TEST, encoding="utf-8")
    git(pilot, "commit", "-q", "-am", "test: reproduce guest checkout KeyError 'tier'")
    pricing.write_text(pricing.read_text(encoding="utf-8").replace(BUG_FUNCTION, FIX_FUNCTION), encoding="utf-8")
    git(pilot, "commit", "-q", "-am", "fix: missing or unknown loyalty tier gives 0% discount")
    git(pilot, "push", "-q", "-u", "origin", branch)
    git(pilot, "checkout", "-q", "main")
    remote = git(pilot, "remote", "get-url", "origin").removesuffix(".git")
    say(True, f"Fresh fix branch pushed: {branch}")
    print(f"\nOpen the PR only AFTER the Night incident has started:\n  {remote}/pull/new/{branch}")
    return 0


# ---------- start / reset ----------

def _web_env(user: str) -> dict:
    import os

    return {**os.environ, "NIGHT_FIXTURES": "1", "NIGHT_TEAM_ENTRY": "1", "NIGHT_API_ORIGIN": API,
            "DANA_DEV_WS_BASE": API.replace("http:", "ws:"), "NIGHT_DEMO_USER": user, "NEXT_TELEMETRY_DISABLED": "1"}


def start(build: bool) -> int:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if npx is None:
        raise SystemExit("npx not found: install Node.js first.")
    if build or not (WEB_DIR / ".next").exists():
        print("Building the web app (about a minute)...")
        subprocess.run([shutil.which("npm") or "npm.cmd", "run", "build"], cwd=WEB_DIR, check=True)
    procs = [
        subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
                         cwd=API_DIR),
        # One window for the presenter: pick who you are on /session (Night engineer, then Morning engineer).
        subprocess.Popen([npx, "next", "start", "--hostname", "127.0.0.1", "--port", "3000"], cwd=WEB_DIR,
                         env=_web_env("demo-a")),
    ]
    time.sleep(6)
    print()
    print("Running. Open http://127.0.0.1:3000/session and pick who you are (demo-a = Night engineer).")
    print("         Your incidents: http://127.0.0.1:3000/home  (Continue opens the right stage)")
    print("         After the handoff, 'Continue as the Morning engineer (tung)' switches you over.")
    print("Press Ctrl+C to stop everything.")
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()
    return 0


def reset(level: str) -> int:
    request = urllib.request.Request(f"{API}/api/demo/reset", data=json.dumps({"level": level}).encode(),
                                     headers={"Content-Type": "application/json", "X-Demo-User": "duy"})
    with urllib.request.urlopen(request, timeout=8) as response:
        state = json.loads(response.read())
    say(True, f"inc_demo reset: {state['phase']} at {state['sim_clock']}, level {state['level']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("check", "reset-pilot", "start", "reset"))
    parser.add_argument("--pilot", type=Path, default=DEFAULT_PILOT, help="local clone of shopnorth-checkout")
    parser.add_argument("--build", action="store_true", help="rebuild the web app before starting")
    parser.add_argument("--no-fix-branch", action="store_true",
                        help="reset-pilot: only put the bug back (the learner writes the fix)")
    parser.add_argument("--level", default="explore", choices=("explore", "practice", "challenge"))
    args = parser.parse_args()
    if args.command == "check":
        return check(args.pilot)
    if args.command == "reset-pilot":
        return reset_pilot(args.pilot, fix_branch=not args.no_fix_branch)
    if args.command == "start":
        return start(args.build)
    return reset(args.level)


if __name__ == "__main__":
    sys.exit(main())
