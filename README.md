# Incident Lab

Hack the Change 2026 · Prompt 2 · 20-hour build · 5 people

A flight simulator for software jobs: a 2 a.m. incident call, a real fix the next morning, real connections after.
The full plan lives in `docs/` (paste the working plan there).

## Who owns what

| Folder | Owner | What goes here |
|---|---|---|
| `apps/web/` | Frontend (___) | Next.js app: call screens, dashboard, logs, deploys, rollback UI, office (3D + 2D route), evidence + connection screens |
| `services/api/` | Backend (___) | FastAPI: incident engine, routes, GitHub PR verify, Auth0, Tiger Data, Adzuna, deploy |
| `services/api/voice/` | AI (Luan) | Deepgram relay, Dana's three calls, read-only tools |
| `services/api/ai/` | AI (Luan) | Gemini prompts, grounding, debrief rubric scoring, validators |
| `packages/contracts/` | Backend + Frontend + AI (agree in hour 1) | Shared schemas: incident state, API types |
| `scenario/` | BA2 (___) | scenario.json, logs, metrics, answer keys, before/after questions, test cases |
| `docs/` | BA1 (___) | Spec, acceptance criteria, wireframes, pitch, runbook |

**Rule:** only the owner edits their folder. Changes anywhere else go through a reviewed PR.

## Not in this repo

`shopnorth-checkout` (the buggy demo shop + tests + GitHub Actions) is a **separate public repo**, owned by Backend.
