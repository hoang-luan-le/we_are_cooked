"""Runtime settings. One .env file for the whole repo: the repo root's. Every value is optional."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

API_DIR = Path(__file__).resolve().parent
REPO_ROOT = API_DIR.parent.parent
DEFAULT_SCENARIO_PATH = REPO_ROOT / "scenario" / "scenario.json"
DEFAULT_SQLITE_PATH = API_DIR / "data" / "incident_lab.db"   # services/api/data/ is gitignored
DEFAULT_DEMO_TEAM = ("duy", "tung", "luan", "demo-a", "demo-b")


def env(name: str) -> str:
    """An env value, stripped. A value that is really a comment ("NAME=   # note") counts as empty."""
    value = os.environ.get(name, "").strip()
    return "" if value.startswith("#") else value


def _handles(raw: str) -> tuple[str, ...]:
    return tuple(h.strip().lower() for h in raw.split(",") if h.strip())


@dataclass(frozen=True)
class Settings:
    scenario_path: Path = DEFAULT_SCENARIO_PATH
    internal_key: str = ""          # shared secret for server-to-server calls (Dana relay)
    demo_team: tuple[str, ...] = DEFAULT_DEMO_TEAM
    auth0_domain: str = ""
    auth0_audience: str = ""             # the API identifier configured in Auth0
    cors_origins: tuple[str, ...] = ()   # empty = every origin (dev only)
    database_url: str = ""               # empty = local SQLite at sqlite_path
    sqlite_path: str = ":memory:"        # from_env() uses DEFAULT_SQLITE_PATH; tests keep memory
    github_token: str = ""               # read-only; empty = public rate limits
    pilot_repos: tuple[str, ...] = ()    # "owner/repo" allowlist; empty = GitHub features off
    mentor_github: tuple[str, ...] = ()  # GitHub logins of mentors who agreed to review
    jobs_snapshot_path: Path = API_DIR / "data" / "jobs_snapshot.json"   # written by adzuna.py

    @property
    def demo_mode(self) -> bool:
        """No Auth0 configured: X-Demo-User is accepted for handles on the demo team."""
        return not self.auth0_domain

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(REPO_ROOT / ".env")
        scenario = env("SCENARIO_PATH")
        team = _handles(env("DEMO_TEAM"))
        return cls(
            scenario_path=Path(scenario) if scenario else DEFAULT_SCENARIO_PATH,
            internal_key=env("INTERNAL_KEY"),
            demo_team=team or DEFAULT_DEMO_TEAM,
            auth0_domain=env("AUTH0_DOMAIN"),
            auth0_audience=env("AUTH0_AUDIENCE"),
            cors_origins=_origins(env("CORS_ORIGINS")),
            database_url=env("DATABASE_URL"),
            sqlite_path=env("SQLITE_PATH") or str(DEFAULT_SQLITE_PATH),
            github_token=env("GITHUB_TOKEN"),
            pilot_repos=_handles(env("PILOT_REPOS")),
            mentor_github=_handles(env("MENTOR_GITHUB")),
            jobs_snapshot_path=Path(env("JOBS_SNAPSHOT_PATH")
                                    or API_DIR / "data" / "jobs_snapshot.json"),
        )


def _origins(raw: str) -> tuple[str, ...]:
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
