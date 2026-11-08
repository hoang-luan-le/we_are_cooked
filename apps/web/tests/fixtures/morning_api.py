"""Local Phase 04 browser fixture. FastAPI and Dana are real, GitHub is deterministic."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import sys

import httpx

api = Path(__file__).resolve().parents[4] / "services" / "api"
sys.path[:0] = [str(api), str(api / "tests")]

from config import Settings  # noqa: E402
from main import create_app  # noqa: E402
from test_smoke import FakeGitHub, PILOT  # noqa: E402
from voice.config import INTERNAL_KEY  # noqa: E402

created = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
pulls = {
    "12": FakeGitHub(created=created),
    "13": FakeGitHub(created=created, number=13, merged=False, ci="pending"),
    "14": FakeGitHub(created=created, number=14, merged=False, ci="failure"),
    "15": FakeGitHub(created=created, number=15, files=("docs/README.md",)),
    "16": FakeGitHub(created=created, number=16, merged=False, reviews=[
        {"user": {"login": "duy-gh"}, "state": "APPROVED", "body": "This is a review from the author."},
    ]),
    "18": FakeGitHub(created=created, number=18, reviews=[
        {"user": {"login": "duy-gh"}, "state": "APPROVED", "body": "This is a review from the author."},
    ]),
}


def transport(request):
    path = request.url.path
    match = re.search(r"/pulls/(\d+)", path)
    if match:
        number = match.group(1)
    else:
        commit = re.search(r"/commits/phase4-(\d+)", path)
        number = commit.group(1) if commit else "12"
    fake = pulls.get(number)
    if fake is None:
        return httpx.Response(404, json={"message": "Fixture PR not found"})
    mapped = path.replace(f"/pulls/{number}", "/pulls/12") if match else path.replace(f"phase4-{number}", "abc123")
    response = fake.handle(httpx.Request(request.method, request.url.copy_with(path=mapped)))
    if match and path.endswith(f"/pulls/{number}") and response.is_success:
        data = response.json()
        data["head"]["sha"] = f"phase4-{number}"
        data["html_url"] = f"https://github.com/{PILOT}/pull/{number}"
        return httpx.Response(200, json=data)
    return response


# Share the relay key while keeping the fixture in demo mode with in-memory SQLite.
settings = Settings(internal_key=INTERNAL_KEY, pilot_repos=(PILOT,), sqlite_path=":memory:")
app = create_app(settings, github_transport=httpx.MockTransport(transport))
