"""Test everything, in the right order, with the right settings. Prints one PASS/FAIL summary.

    cd services/api
    python test_all.py            # everything (about 10 minutes)
    python test_all.py --quick    # backend + web typecheck/build only (about 2 minutes)

What it runs:
  1-3  backend smoke tests, Dana voice offline checks, live Tiger Data check (if DATABASE_URL is Postgres)
  4-5  web typecheck and build
  6-7  Tung's offline browser suites (2D, 3D)
  8-11 browser suites against an ISOLATED test backend on :8100 (in-memory, no Tiger Data, no Deepgram,
       no GitHub), plus a second browser identity (demo-b) on :3212
  12   Morning suite against Tung's fixture backend on :3214 (real API, scripted GitHub)

Your own demo servers (3000/3001/8000) are not touched. Full output of each step: services/api/data/test-logs/.
"""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from config import API_DIR, REPO_ROOT, Settings

WEB = REPO_ROOT / "apps" / "web"
LOGS = API_DIR / "data" / "test-logs"
NPX = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
NPM = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
PY = sys.executable
TEST_API, FIXTURE_API, PEER = "http://127.0.0.1:8100", "http://127.0.0.1:3214", "http://127.0.0.1:3212"
PORTS_NEEDED = (8100, 3210, 3212, 3214, 3220)
# The isolated test backend: nothing saved, no cloud services; the relay reads facts from itself.
ISOLATED = {"SQLITE_PATH": ":memory:", "DATABASE_URL": "", "DEEPGRAM_API_KEY": "", "PILOT_REPOS": "",
            "AUTH0_DOMAIN": "", "CORS_ORIGINS": ""}

results: list[tuple[str, str, str]] = []   # (step, PASS/FAIL/SKIP, detail)


def env_with(**extra: str) -> dict:
    return {**os.environ, "NEXT_TELEMETRY_DISABLED": "1", "PYTHONIOENCODING": "utf-8", **extra}


def record(step: str, status: str, detail: str = "") -> None:
    results.append((step, status, detail))
    print(f"  {status:4}  {step}{('  -  ' + detail) if detail else ''}", flush=True)


def run(step: str, cmd: list[str], cwd: Path, env: dict | None = None, timeout: int = 900,
        ok_text: str | None = None) -> bool:
    log = LOGS / (step.lower().replace(" ", "-").replace("/", "-") + ".log")
    started = time.monotonic()
    try:
        done = subprocess.run(cmd, cwd=cwd, env=env or env_with(), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
        output, code = done.stdout + done.stderr, done.returncode
    except subprocess.TimeoutExpired as exc:
        output, code = f"{exc.stdout or ''}{exc.stderr or ''}\nTIMED OUT after {timeout}s", -1
    log.write_text(output, encoding="utf-8")
    ok = code == 0 and (ok_text is None or ok_text in output)
    record(step, "PASS" if ok else "FAIL", f"{time.monotonic() - started:.0f}s" + ("" if ok else f", see {log}"))
    return ok


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def wait_for(url: str, timeout: float = 60) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":  # npx/next start child processes; kill the whole tree
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


@contextmanager
def server(name: str, cmd: list[str], cwd: Path, env: dict, ready_url: str):
    log = open(LOGS / f"server-{name}.log", "w", encoding="utf-8")
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        if not wait_for(ready_url):
            raise RuntimeError(f"{name} did not start; see {LOGS / f'server-{name}.log'}")
        yield
    finally:
        kill_tree(proc)
        log.close()


def backend_steps() -> None:
    run("Backend smoke tests", [PY, "tests/test_smoke.py"], API_DIR, ok_text="ALL GOOD")
    run("Dana voice offline checks", [PY, "-m", "voice.test_offline"], API_DIR, ok_text="all offline checks passed")
    if Settings.from_env().database_url.startswith(("postgres://", "postgresql://")):
        run("Tiger Data live check", [PY, "tests/check_tigerdata.py"], API_DIR, ok_text="TIGER DATA OK")
    else:
        record("Tiger Data live check", "SKIP", "DATABASE_URL is not Postgres")
    shutil.rmtree(API_DIR / "voice" / "logs", ignore_errors=True)


def web_steps() -> bool:
    if not run("Web typecheck", [NPM, "run", "typecheck"], WEB):
        return False
    return run("Web build", [NPM, "run", "build"], WEB)


def browser_steps() -> None:
    run("Browser 2D offline", [NPX, "playwright", "test", "--retries=1"], WEB)
    run("Browser 3D offline", [NPX, "playwright", "test", "-c", "playwright.world.config.ts", "--retries=1"], WEB)

    api_env = env_with(**ISOLATED, DANA_FACTS=TEST_API)
    peer_env = env_with(NIGHT_FIXTURES="1", NIGHT_TEAM_ENTRY="1", NIGHT_API_ORIGIN=TEST_API,
                        NIGHT_DEMO_USER="demo-b", DANA_DEV_WS_BASE=TEST_API.replace("http:", "ws:"))
    test_env = env_with(NIGHT_TEST_API_ORIGIN=TEST_API, NIGHT_TEST_RELAY_BASE=TEST_API.replace("http:", "ws:"))
    uvicorn = [PY, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8100"]
    with server("test-api", uvicorn, API_DIR, api_env, f"{TEST_API}/health"):
        run("Browser night-api", [NPX, "playwright", "test", "tests/night-api.spec.ts", "--retries=1"], WEB, test_env)
        team_env = {**test_env, "NIGHT_TEST_TEAM_ENTRY": "1"}
        run("Browser team-entry", [NPX, "playwright", "test", "tests/team-entry.spec.ts", "--retries=1"], WEB, team_env)
        run("Browser 3D with API", [NPX, "playwright", "test", "-c", "playwright.world.config.ts", "--retries=1"],
            WEB, test_env)
        peer = [NPX, "next", "start", "--hostname", "127.0.0.1", "--port", "3212"]
        with server("peer-demo-b", peer, WEB, peer_env, PEER):
            run("Browser night-board (two people)",
                [NPX, "playwright", "test", "tests/night-board.spec.ts", "--retries=1"], WEB,
                {**team_env, "NIGHT_TEST_PEER_ORIGIN": PEER})

    # Morning: Tung's fixture = our real API + scripted GitHub. Its Settings() has no INTERNAL_KEY,
    # so the relay inside it must not send one either.
    fixture_env = env_with(**ISOLATED, INTERNAL_KEY="", DANA_FACTS=FIXTURE_API)
    fixture = [PY, "-m", "uvicorn", "morning_api:app", "--app-dir", "apps/web/tests/fixtures",
               "--host", "127.0.0.1", "--port", "3214"]
    morning_peer_env = {**peer_env, "NIGHT_API_ORIGIN": FIXTURE_API, "MORNING_GITHUB_FIXTURE": "1",
                        "DANA_DEV_WS_BASE": FIXTURE_API.replace("http:", "ws:")}
    with server("morning-fixture", fixture, REPO_ROOT, fixture_env, f"{FIXTURE_API}/health"):
        with server("peer-morning", [NPX, "next", "start", "--hostname", "127.0.0.1", "--port", "3212"],
                    WEB, morning_peer_env, PEER):
            run("Browser morning", [NPX, "playwright", "test", "tests/morning.spec.ts", "--retries=1"], WEB,
                env_with(NIGHT_TEST_MORNING="1", NIGHT_TEST_TEAM_ENTRY="1", NIGHT_TEST_API_ORIGIN=FIXTURE_API,
                         NIGHT_TEST_RELAY_BASE=FIXTURE_API.replace("http:", "ws:"), NIGHT_TEST_PEER_ORIGIN=PEER))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--quick", action="store_true", help="backend + web typecheck/build only")
    args = parser.parse_args()
    LOGS.mkdir(parents=True, exist_ok=True)
    print("Testing everything. Logs: " + str(LOGS))
    if not args.quick:
        busy = [p for p in PORTS_NEEDED if not port_free(p)]
        if busy:
            print(f"Ports in use: {busy}. Stop whatever runs there (test servers only; 3000/3001/8000 are fine).")
            return 2
    backend_steps()
    built = web_steps()
    if not args.quick:
        if built:
            browser_steps()
        else:
            record("Browser suites", "SKIP", "the web build failed")
    print("\nSummary")
    for step, status, detail in results:
        print(f"  {status:4}  {step}{('  -  ' + detail) if detail else ''}")
    failed = [r for r in results if r[1] == "FAIL"]
    print("\nALL PASSED" if not failed else f"\n{len(failed)} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
