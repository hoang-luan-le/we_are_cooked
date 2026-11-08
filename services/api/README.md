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
| `store.py` | In-memory incidents (demo mode) with idempotency keys |
| `routes/` | `/api/incident/{id}`, `/facts`, `/action`, `/hint`, `/api/debrief`, `/api/demo/reset` |

Contract: `packages/contracts/types.ts` and `dana-voice.md` §5.

## Not built yet
Handoff + `handed_off` phase, cohorts, PR verify (GitHub), Auth0 tokens, SQLite/Tiger Data persistence, panel content (logs/deploys/runbook), Adzuna, open-source issues.
