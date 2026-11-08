# Manual test: the live demo, by hand

Two browser windows, two people (you can play both):

- **Night pair** = window 1: <http://127.0.0.1:3000> (signed in as `demo-a`)
- **Morning pair** = window 2: <http://127.0.0.1:3001> (signed in as `tung`)

Tick each box. If what you see differs from **Expect**, note the step number and what you saw.

## 0. Before you start (PowerShell, `D:\we_are_cooked\services\api`)

- [ ] `python demo.py check`. **Expect:** every line `OK` (Tiger Data reachable, pilot repo has the bug, 3 servers running).
  - Pilot repo line says `!!`: run `python demo.py reset-pilot`. It prints a PR link; **don't open it yet**.
  - Servers not running: `python demo.py start` (leave that window open).

## 1. Night shift: window 1 (3000)

- [ ] 1.1 Open <http://127.0.0.1:3000/start>. Pick a level → **Start solo incident**.
- [ ] 1.2 **Expect:** "02:04 a.m. **Dana is calling.**" with **Answer Dana by text**, **Answer Dana with voice**, **Snooze**.
- [ ] 1.3 Click **Snooze**. **Expect:** "Page snoozed. Dana will ring again shortly." It rings again after about 15 s.
- [ ] 1.4 **Answer Dana by text**. **Expect:** captions from Dana with the real numbers (about 27–31% of checkouts failing). Type "what changed tonight?". **Expect:** she mentions the v2.14.0 release at 1:47 a.m. Finish the call.
- [ ] 1.5 **Dashboard:** error rate high (~31%), **Loyalty discounts: ON** in words. The chart shows errors climbing from about 01:47.
- [ ] 1.6 **Logs:** filter **Error**, search `KeyError`. **Expect:** only guest checkouts failing with `KeyError: 'tier' at checkout/pricing.py:19`.
- [ ] 1.7 **Deploy history** → open the v2.14.0 diff. **Expect:** label "· GitHub" and `customer.profile["tier"]` in the diff.
- [ ] 1.8 **Runbooks** → "Checkout error rate is high". **Expect:** 5 steps, starting with "stop the damage".
- [ ] 1.9 Share a finding (e.g. "Only guests fail: KeyError tier after v2.14.0").
- [ ] 1.10 Wait about 2 minutes without a status update. **Expect:** "Dana is calling for a status update" with the VP message. Send a status update. **Expect:** the nudge goes away.
- [ ] 1.11 **Roll back.** **Expect:** errors drop to ~0.4% within about 10 s, **Loyalty discounts: OFF**, phase recovered/stabilized.
- [ ] 1.12 Refresh the page (F5). **Expect:** you're back on the same board, nothing lost.
- [ ] 1.13 **Write shift handoff:** fill all four parts; **Morning teammate handles:** `tung` → **Save shift handoff**. **Expect:** "Shift handoff saved." Banner/phase shows the handoff happened.

## 2. Morning shift: window 2 (3001)

- [ ] 2.1 Open <http://127.0.0.1:3001/morning> (or `/morning/3d` for the 3D office). **Expect:** "Your morning" → **Handed to you**: your incident, "Next: **Read and rate the Night handoff**", **Open** button. (Before step 1.13 it says "Nothing has been handed to you yet" and refreshes by itself.)
- [ ] 2.2 **Open** → read the Night handoff → rate it (1–5, one line). **Expect:** the rating is saved; the Night window shows it.
- [ ] 2.3 Open **How to fix it in VS Code (step by step)**. **Expect:** 6 steps with **Copy** buttons.
- [ ] 2.4 Fix the bug (follow the steps in VS Code on `D:\shopnorth-checkout`, **or** use the branch `demo.py reset-pilot` printed). **Only now** open the pull request on GitHub.
- [ ] 2.5 On GitHub, watch CI. **Expect:** green in about 20 s, both "Unit tests" and "Guard tests" steps.
- [ ] 2.6 Ask a teammate for a **real review** from their own GitHub account (a sentence about what they checked). Then **merge**.
  - No reviewer available: Verify still works, but **Deploy stays off** (peer review is required). That's correct, not a bug.
- [ ] 2.7 Paste the PR link into **Verify the checkout fix**. **Expect:** merged, CI passing, review shown (mentor named if one reviewed).
- [ ] 2.8 **Deploy the fix**. **Expect:** status fixed, **Loyalty discounts: ON**, error rate at baseline. Deploy history: live version **v2.14.1**.
- [ ] 2.9 **Debrief with Dana by text:** say what you'd tell customers and the VP (impact, cause, action, risk). **Expect:** "**Final server rubric**", 5 scores each with a one-line reason; **20/20** with a real review, 18/20 without.
- [ ] 2.10 **Private incident evidence** shows the PR, CI, handoff rating and score, with **no** email or GitHub name.

## 3. After: both windows

- [ ] 3.1 Each person answers "work together again?" about the other. **Expect:** after only one yes, nothing is shown; after both say yes, a connection card with the contact line (if set).
- [ ] 3.2 Jobs: **Listings from Adzuna as of** a date (real listings). Next real fix: open-source issues by skill (if shown).

## 4. Fallbacks (quick)

- [ ] 4.1 Turn Wi-Fi off, refresh the Night board. **Expect:** the board still works (local API); Dana falls back to text/scripted.
- [ ] 4.2 Turn Wi-Fi back on.

## Reset for the next run

`python demo.py reset-pilot` (bug back + fresh fix branch) and start a new incident from `/start`.
Open the fix PR only **after** the new incident has started, or Verify says the PR is too old.
