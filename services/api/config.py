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


def _handles(raw: str) -> tuple[str, ...]:
    return tuple(h.strip().lower() for h in raw.split(",") if h.strip())


@dataclass(frozen=True)
class Settings:
    scenario_path: Path = DEFAULT_SCENARIO_PATH
    internal_key: str = ""          # shared secret for server-to-server calls (Dana relay)
    demo_team: tuple[str, ...] = DEFAULT_DEMO_TEAM
    auth0_domain: str = ""
    cors_origins: tuple[str, ...] = ()   # empty = every origin (dev only)
    database_url: str = ""               # empty = local SQLite at sqlite_path
    sqlite_path: str = ":memory:"        # from_env() uses DEFAULT_SQLITE_PATH; tests keep memory

    @property
    def demo_mode(self) -> bool:
        """No Auth0 configured: X-Demo-User is accepted for handles on the demo team."""
        return not self.auth0_domain

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(REPO_ROOT / ".env")
        scenario = os.environ.get("SCENARIO_PATH", "").strip()
        team = _handles(os.environ.get("DEMO_TEAM", ""))
        return cls(
            scenario_path=Path(scenario) if scenario else DEFAULT_SCENARIO_PATH,
            internal_key=os.environ.get("INTERNAL_KEY", "").strip(),
            demo_team=team or DEFAULT_DEMO_TEAM,
            auth0_domain=os.environ.get("AUTH0_DOMAIN", "").strip(),
            cors_origins=_origins(os.environ.get("CORS_ORIGINS", "")),
            database_url=os.environ.get("DATABASE_URL", "").strip(),
            sqlite_path=os.environ.get("SQLITE_PATH", "").strip() or str(DEFAULT_SQLITE_PATH),
        )

    def is_known_handle(self, handle: str) -> bool:
        """Demo mode only knows the demo team. With Auth0 there's no users table yet, so accept."""
        return handle in self.demo_team if self.demo_mode else bool(handle)


def _origins(raw: str) -> tuple[str, ...]:
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
