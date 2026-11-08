# services/api — Backend

**Owner:** Duy

**P0:** incident engine (deterministic state machine), API routes, Tiger Data, Auth0, pilot repo + Actions, PR verify, Adzuna, deploy.

**Gates:** T+3 `/health` + scenario loaded ✅ · T+9 incident endpoints + PR read (incident endpoints ✅, PR read to do).

`voice/` and `ai/` inside this folder belong to the AI owner. Their router is mounted in `main.py`, so the API and `ws://…/ws/voice` share one port.

## Run

```
cd services/api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000      # reads the repo-root .env
python tests/test_smoke.py                 # must print ALL GOOD before you push
```

## Layout

| Path | What |
|---|---|
| `main.py` | App factory, `/health`, mounts routes + Dana's voice router |
| `config.py` / `auth.py` | Settings from the root `.env`; `X-Internal-Key` / `X-Demo-User` |
| `scenario_loader.py` / `scenario_models.py` | Loads + validates `scenario/scenario.json`; splits off `answer_key` |
| `engine/` | Pure functions over frozen state: actions, metrics, help ladder + nudge, rubric, response views |
| `store.py` | Live incidents in memory, a snapshot saved after every change; idempotency keys |
| `db.py` / `engine/snapshot.py` | SQLite tables `incidents`, `cohorts`, `cohort_members` (file in `data/`, gitignored) |
| `engine/panels.py` | Logs (deterministic per second), deploy history + diff, runbooks, metrics history |
| `routes/` | `/logs`, `/deploys`, `/runbooks`, `/metrics/history`; `/api/incident/start`, `/api/incident/{id}`, `/facts`, `/action`, `/hint`, `/handoff` (+ `/rating`), `/api/debrief`, `/api/cohorts`, `/api/demo/reset` |
| `github_client.py` / `routes/pr.py` | Read-only GitHub (PILOT_REPOS allowlist, 15 s cache): `POST /api/pr/verify`, real release diffs |
| `network.py` / `routes/network.py` | `/api/me`, private connection answers, mutual-only `/api/network`, public `/api/evidence/{handle}` |
| `cohorts.py` | Cohorts: create, join by code, members-only list |

Contract: `packages/contracts/types.ts` and `dana-voice.md` §5.

## Not built yet
Pilot repo on GitHub (contents ready in `D:shopnorth-checkout`), Auth0 tokens, Tiger Data (Postgres) + metrics history, Adzuna, open-source issues.
