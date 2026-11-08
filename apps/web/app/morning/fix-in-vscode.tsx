"use client";

import { useState } from "react";
import type { Pilot } from "./pilot";

type Step = { title: string; detail: string; command?: string; link?: { href: string; label: string } };

function stepsFor(pilot: Pilot | undefined): Step[] {
  const folder = pilot?.repo.split("/")[1] ?? "shopnorth-checkout";
  const base = pilot?.base_branch ?? "main";
  return [
    pilot ? {
      title: "Get your team's code",
      detail: `The bug lives in your team's repo, ${pilot.repo}. Clone it once, then open it in VS Code. `
        + "To open a pull request you need write access: ask the repo owner to add your GitHub account as a "
        + "collaborator (or fork the repo and open the PR from your fork).",
      command: `git clone ${pilot.clone_url} && code ${folder}`,
      link: { href: pilot.url, label: `Open ${pilot.repo} on GitHub` },
    } : {
      title: "Get your team's code",
      detail: "Ask your team for the link to the pilot repo (shopnorth-checkout), clone it, and open it in VS Code.",
    },
    {
      title: "Start a branch",
      detail: "In VS Code, open the terminal (Ctrl+`) inside the repo folder.",
      command: `git checkout ${base} && git pull && git checkout -b fix/guest-checkout`,
    },
    {
      title: "Run the tests",
      detail: "Install the test tools once, then run the unit tests. They pass: nothing tests guests yet.",
      command: "pip install -r requirements-dev.txt && python -m pytest tests -q",
    },
    {
      title: "Reproduce the bug with a failing test",
      detail: "In tests/test_pricing.py, add a test for a guest customer (guest=True, no loyalty tier) that checks the "
        + "order total. Run the tests again: your new test should fail the same way checkout failed last night.",
      command: "python -m pytest tests -q",
    },
    {
      title: "Fix the code",
      detail: "Fix checkout/pricing.py so guests and customers without a known tier can check out. "
        + "Careful: catching the error and charging $0 is not a fix. The guard tests check that no order is ever free.",
    },
    {
      title: "Check everything CI will check",
      detail: "Unit tests and the guard tests should all pass.",
      command: "python -m pytest tests ci/guards -q",
    },
    {
      title: "Open a pull request",
      detail: `Push, open the PR against ${base} on GitHub, and ask a teammate for a real review (a sentence or two `
        + "about what they checked). Deploy unlocks once the PR is merged, CI is green and a teammate has reviewed it.",
      command: "git add -A && git commit -m \"fix: guests get no loyalty discount\" && git push -u origin fix/guest-checkout",
    },
  ];
}

/** Step-by-step guide for the Morning pair: the fix happens in VS Code on the real pilot repo, not in the browser. */
export function FixInVsCode({ pilot, open = true }: { pilot?: Pilot; open?: boolean }) {
  const [copied, setCopied] = useState("");
  return (
    <details className="entry-section fix-guide" open={open}>
      <summary>How to fix it in VS Code (step by step)</summary>
      <ol>
        {stepsFor(pilot).map(step => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
            {step.link ? (
              <p><a href={step.link.href} target="_blank" rel="noopener noreferrer">{step.link.label}</a></p>
            ) : null}
            {step.command ? (
              <div className="fix-command">
                <code>{step.command}</code>
                <button type="button" aria-label={`Copy command: ${step.command}`} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(step.command ?? "");
                    setCopied(step.title);
                  } catch {
                    setCopied("");
                  }
                }}>Copy</button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <p role="status">{copied ? `Copied the command for "${copied}".` : ""}</p>
    </details>
  );
}
