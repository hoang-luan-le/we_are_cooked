"use client";

import { useState } from "react";
import type { CheckView } from "../../../../packages/contracts/types";
import { useMorningResource, useMorningWrite } from "./use-morning-api";

export function IncidentCheck({ incident, night = false, fixed = false, unavailable = false }: { incident: string; night?: boolean; fixed?: boolean; unavailable?: boolean }) {
  const { data, status, reload } = useMorningResource<CheckView>(incident, "checks");
  const { busy, submit } = useMorningWrite(incident);
  const [error, setError] = useState("");
  const disabled = busy || unavailable || status === undefined;
  const stage = data && !data.before && !fixed ? "before" : !night && fixed && data?.before && !data.after ? "after" : undefined;

  return (
    <section className="panel phase-panel" aria-labelledby="check-title">
      <h2 id="check-title">{night ? "Before the incident" : "Before and after check"}</h2>
      {status === undefined && !data ? <p role="status">Loading the check…</p> : null}
      {status !== undefined && !data ? <div className="entry-section">
        <p role="alert">The check is unavailable.</p><button onClick={reload}>Retry check</button>
      </div> : null}
      {data && fixed && !data.before ? <p>There’s no baseline answer for this member on this incident.</p> : null}
      {data?.before && !data.after ? <p>Baseline saved. Scores appear after you answer again following the fix.</p> : null}
      {data?.before && data.after ? (
        <dl className="service-facts">
          <div><dt>Before score</dt><dd>{data.before.score ?? "Pending"} / 4</dd></div>
          <div><dt>After score</dt><dd>{data.after.score ?? "Pending"} / 4</dd></div>
          {data.improved !== null ? <div><dt>Change</dt><dd>{data.improved > 0 ? "+" : ""}{data.improved} points</dd></div> : null}
        </dl>
      ) : null}
      {data && stage ? <form key={stage} className="entry-section" onSubmit={async event => {
        event.preventDefault();
        if (disabled) return;
        const fields = new FormData(event.currentTarget);
        const choice = fields.get("choice");
        if (typeof choice !== "string") return;
        setError("");
        const result = await submit({ operation: "check", stage, choice, explanation: String(fields.get("explanation") ?? "") });
        if (result?.ok) reload();
        else if (result) setError("The API did not confirm your answer. Refresh the check before trying again.");
      }}>
        <fieldset className="entry-levels" disabled={disabled}>
          <legend>{data.question}</legend>
          {data.choices.map(choice => <label key={choice.id} className="entry-option">
            <input name="choice" type="radio" value={choice.id} required /><span>{choice.text}</span>
          </label>)}
        </fieldset>
        <label>Reasoning (optional)<textarea name="explanation" rows={2} maxLength={500} readOnly={busy} /></label>
        <button disabled={disabled}>{stage === "before" ? "Save baseline answer" : "Save follow-up answer"}</button>
        {error ? <p role="alert" className="notice">{error}</p> : null}
      </form> : null}
    </section>
  );
}
