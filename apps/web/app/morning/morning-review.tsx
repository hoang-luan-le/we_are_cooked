"use client";

import { useRef, useState } from "react";
import type { Handoff, HandoffRatingRequest, PullRequestInfo } from "../../../../packages/contracts/types";
import type { NightIncident } from "../night/use-night-api";
import { githubPullUrl } from "./morning-contract";
import { useMorningWrite } from "./use-morning-api";

const ciLabels = { success: "Passing", failure: "Failed", pending: "Pending", none: "No result found" } as const;
const verifyErrors: Record<string, string> = {
  bad_pr_url: "Enter a GitHub pull request link.",
  repo_not_allowed: "Use a pull request from the configured pilot repository.",
  pr_wrong_base: "This PR targets the wrong branch for the exercise.",
  pr_not_a_fix: "This PR does not change the checkout code for this incident.",
  pr_too_old: "This PR predates the incident.",
  pr_already_linked: "A different merged PR is already recorded for this incident.",
  github_off: "GitHub verification is unavailable in this environment. You can still open the link.",
  github_unavailable: "GitHub could not be reached. Retry verification when it is available.",
};

export function HandoffReview({ incident, handoff, user, unavailable, onChange }: {
  incident: string; handoff: Handoff; user: string; unavailable: boolean; onChange: () => void;
}) {
  const { busy, submit } = useMorningWrite(incident);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<Handoff["rating"]>(null);
  const rating = handoff.rating ?? submitted;
  const canRate = !handoff.night_pair.includes(user) && (!handoff.morning_pair.length || handoff.morning_pair.includes(user));

  return (
    <section className="panel phase-panel" aria-labelledby="morning-handoff">
      <h2 id="morning-handoff">Night shift handoff</h2>
      <p className="muted">From {handoff.by} at {handoff.sim_clock}</p>
      {handoff.morning_pair.length ? <p>Morning teammates · {handoff.morning_pair.join(", ")}</p>
        : <p className="muted">Shared demo fallback · no separate Morning pair was named.</p>}
      <dl className="handoff-parts">
        <div><dt>What happened</dt><dd>{handoff.what_happened}</dd></div>
        <div><dt>Current state</dt><dd>{handoff.current_state}</dd></div>
        <div><dt>What was tried</dt><dd>{handoff.tried}</dd></div>
        <div><dt>Remaining risks</dt><dd>{handoff.risks}</dd></div>
      </dl>
      {rating ? <p role="status">Usefulness {rating.score}/5 · {rating.by}{rating.note ? ` · ${rating.note}` : ""}</p> : null}
      {canRate && !rating ? <form className="entry-section" onSubmit={async event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const score = Number(fields.get("score")) as HandoffRatingRequest["score"];
        setError("");
        const result = await submit<Handoff>({ operation: "rate", score, note: String(fields.get("note") ?? "") });
        if (result?.ok) {
          setSubmitted(result.data?.rating ?? null);
          onChange();
        } else if (result) setError("The API did not confirm the rating. Check the shared handoff before retrying.");
      }}>
        <label>Handoff usefulness
          <select name="score" required disabled={busy || unavailable} defaultValue="">
            <option value="">Choose a rating</option>
            {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} / 5</option>)}
          </select>
        </label>
        <label>One line of feedback (optional)<input name="note" maxLength={200} readOnly={busy} /></label>
        <button disabled={busy || unavailable}>{busy ? "Saving rating…" : "Save handoff rating"}</button>
        {error ? <p className="notice" role="alert">{error}</p> : null}
      </form> : null}
    </section>
  );
}

export function MorningReview({ incident, unavailable, onChange, onDeploy }: {
  incident: NightIncident; unavailable: boolean; onChange: () => void; onDeploy: () => Promise<boolean>;
}) {
  const { busy, submit } = useMorningWrite(incident.incident_id);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deployTarget, setDeployTarget] = useState<PullRequestInfo>();
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pr = incident.pr;
  const verifiedUrl = pr ? githubPullUrl(pr.url) : undefined;
  const candidate = githubPullUrl(url.trim());
  const deployAllowed = incident.allowed_actions.includes("deploy_fix");
  const canDeploy = Boolean(pr?.substantive_review && deployAllowed);
  const deployChanged = deployTarget && (!canDeploy || pr?.url !== deployTarget.url || pr?.head_sha !== deployTarget.head_sha);
  const fixed = incident.status === "fixed";

  return (
    <section className="panel phase-panel" aria-labelledby="morning-review">
      <h2 id="morning-review" ref={heading} tabIndex={-1}>Verify the checkout fix</h2>
      <p>Reproduce the guest checkout failure, add a regression test, and open the fix in GitHub for your teammate to review.</p>
      {incident.level === "explore" ? <PracticeReview /> : null}
      {!fixed ? <form className="entry-section" onSubmit={async event => {
        event.preventDefault();
        setError("");
        setNotice("");
        const target = candidate ?? (url.trim() ? undefined : verifiedUrl);
        if (!target) {
          setError(verifyErrors.bad_pr_url);
          return;
        }
        const result = await submit({ operation: "verify", url: target });
        if (result?.ok) {
          setNotice("Verification recorded.");
          onChange();
        } else if (result) {
          setError((result.code && verifyErrors[result.code]) || "The API did not confirm verification. Retry after checking the PR link.");
          onChange();
        }
      }}>
        <label>GitHub pull request
          <input type="url" maxLength={300} value={url} placeholder={verifiedUrl ?? "https://github.com/owner/repo/pull/123"}
            readOnly={busy} onChange={event => { setUrl(event.target.value); setError(""); setNotice(""); }} />
        </label>
        <div className="actions">
          <button className="primary" disabled={busy || unavailable || (!url.trim() && !verifiedUrl)}>
            {busy ? "Checking GitHub…" : pr ? "Recheck pull request" : "Verify pull request"}
          </button>
          {candidate && candidate !== verifiedUrl ? <a className="button" href={candidate} target="_blank" rel="noreferrer">Open submitted PR on GitHub</a> : null}
        </div>
        {error ? <p className="notice" role="alert">{error}</p> : null}
        {notice ? <p className="muted" role="status">{notice}</p> : null}
      </form> : null}
      {pr ? (
        <>
          <h3>Last verified PR #{pr.number}</h3>
          {verifiedUrl ? <a href={verifiedUrl} target="_blank" rel="noreferrer">Open verified PR on GitHub</a> : null}
          <dl className="service-facts">
            <div><dt>Continuous integration</dt><dd>{ciLabels[pr.ci]}</dd></div>
            <div><dt>Peer review</dt><dd>{pr.substantive_review ? "Substantive review recorded" : "Substantive review pending"} · {pr.review_count} non-author</dd></div>
            <div><dt>Merge</dt><dd>{pr.merged ? "Merged" : "Open or unmerged"}</dd></div>
            {pr.mentor_review ? <div><dt>Mentor review</dt><dd>{pr.mentor_review}</dd></div> : null}
            <div><dt>Head commit</dt><dd><code>{pr.head_sha}</code></dd></div>
          </dl>
        </>
      ) : <p className="muted">No GitHub pull request has been verified for this incident.</p>}
      {fixed ? <p className="badge success">Fix deployed · Discounts {incident.loyalty_discounts}</p> : null}
      {pr && deployAllowed && !pr.substantive_review ? <p className="notice">A substantive independent review is required before deployment.</p> : null}
      {pr && canDeploy ? (
        <button className="primary" disabled={unavailable || busy} onClick={() => {
          setDeployTarget(pr);
          dialog.current?.showModal();
        }}>Deploy fix</button>
      ) : null}
      <dialog ref={dialog} aria-labelledby="deploy-title" onClose={() => {
        setDeployTarget(undefined);
        if (!canDeploy) heading.current?.focus();
      }}>
        <h2 id="deploy-title">Deploy the fix from PR #{deployTarget?.number}?</h2>
        <p>This deploys the verified merged fix in the simulation and turns loyalty discounts back on.</p>
        {deployChanged ? <p className="notice" role="alert">The PR changed or is no longer eligible. Close this dialog and check the latest verification.</p> : null}
        <div className="actions">
          <button onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="primary" disabled={!deployTarget || deployChanged || unavailable || busy} onClick={() => {
            if (!deployTarget || deployChanged || unavailable || busy) return;
            dialog.current?.close();
            void onDeploy();
          }}>Confirm deploy</button>
        </div>
      </dialog>
    </section>
  );
}

function PracticeReview() {
  const [reviewed, setReviewed] = useState(false);
  return (
    <details className="practice-review">
      <summary>Explore practice review · Scenario sample</summary>
      <p>Review this example for the team’s missing-tier checkout scenario. Your practice notes stay on this screen.</p>
      <pre><code>{'- tier = customer.profile["tier"]\n- return LOYALTY_PERCENT[tier]\n+ tier = customer.profile.get("tier")\n+ return LOYALTY_PERCENT.get(tier, 0)'}</code></pre>
      <form className="entry-section" onSubmit={event => { event.preventDefault(); setReviewed(true); }}>
        <label>Practice review note<textarea rows={2} required maxLength={500} /></label>
        <button>Compare with review notes</button>
      </form>
      {reviewed ? <p role="status">Check that guest and unknown tiers receive no extra discount, existing member prices stay correct, and the regression test catches free orders.</p> : null}
    </details>
  );
}
