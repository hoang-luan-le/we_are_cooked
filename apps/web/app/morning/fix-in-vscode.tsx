"use client";

import { useState } from "react";

const steps: { title: string; detail: string; command?: string }[] = [
  {
    title: "Open the pilot repo and start a branch",
    detail: "Open your team's shopnorth-checkout folder in VS Code (File → Open Folder), then open the terminal (Ctrl+`).",
    command: "git checkout main && git pull && git checkout -b fix/guest-checkout",
  },
  {
    title: "Run the tests",
    detail: "Install the test tools once, then run the unit tests. They pass: nothing tests guests yet.",
    command: "pip install -r requirements-dev.txt && python -m pytest tests -q",
  },
  {
    title: "Reproduce the bug with a failing test",
    detail: "In tests/test_pricing.py, add a test for a guest customer (guest=True, no loyalty tier) that checks the order total. "
      + "Run the tests again: your new test should fail the same way checkout failed last night.",
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
    detail: "Push, open the PR on GitHub, and ask a teammate for a real review (a sentence or two about what they checked). "
      + "Deploy unlocks once the PR is merged, CI is green and a teammate has reviewed it.",
    command: "git add -A && git commit -m \"fix: guests get no loyalty discount\" && git push -u origin fix/guest-checkout",
  },
];

/** Step-by-step guide for the Morning pair: the fix happens in VS Code on the real pilot repo, not in the browser. */
export function FixInVsCode() {
  const [copied, setCopied] = useState("");
  return (
    <details className="entry-section fix-guide">
      <summary>How to fix it in VS Code (step by step)</summary>
      <ol>
        {steps.map(step => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
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
