"use client";

import { useState } from "react";
import type { Note } from "../../../../packages/contracts/types";
import type { NightAction, NightSnapshot } from "./use-night-api";

function Notes({ notes, highlightFrom }: { notes: Note[]; highlightFrom?: number }) {
  if (!notes.length) return <p className="muted">No entries yet.</p>;
  return <ol className="entry-list evidence-list" aria-live="polite">
    {notes.map((note, index) => (
      <li className={highlightFrom !== undefined && index >= highlightFrom ? "new-evidence" : undefined}
        key={JSON.stringify([index, note.by, note.sim_clock, note.text])}>
        <strong>{note.by}</strong> <time>{note.sim_clock}</time>
        <p>{note.text}</p>
      </li>
    ))}
  </ol>;
}

function NoteForm({ action, onAction, disabled }: {
  action: "share_finding" | "status_update";
  onAction: (intent: NightAction) => Promise<boolean>;
  disabled: boolean;
}) {
  const finding = action === "share_finding";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  return (
    <form className="entry-section" onSubmit={async event => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || disabled) return;
      setError(false);
      if (await onAction({ action, text })) setDraft("");
      else setError(true);
    }}>
      <label>{finding ? "Finding" : "Status update"}
        <textarea rows={2} maxLength={finding ? 280 : 500} value={draft} readOnly={disabled}
          aria-invalid={error} aria-describedby={error ? `${action}-error` : undefined}
          onChange={event => { setDraft(event.target.value); setError(false); }} />
      </label>
      <button disabled={disabled || !draft.trim()}>{finding ? "Pin finding" : "Send status update"}</button>
      {error ? <p className="notice" id={`${action}-error`} role="alert">
        The API did not confirm this note. Check the shared list or submit the same text again.
      </p> : null}
    </form>
  );
}

export function TeamEvidence({ snapshot, pending, onAction }: {
  snapshot: NightSnapshot;
  pending: boolean;
  onAction: (intent: NightAction) => Promise<boolean>;
}) {
  const { incident, newFindingFrom } = snapshot;
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Shared incident evidence</h2>
      <h3>Findings</h3>
      <Notes notes={incident.findings} highlightFrom={newFindingFrom} />
      {incident.allowed_actions.includes("share_finding") ? <NoteForm action="share_finding" disabled={pending} onAction={onAction} /> : null}
      <h3>Stakeholder updates</h3>
      <Notes notes={incident.status_updates} />
      {incident.allowed_actions.includes("status_update") ? <NoteForm action="status_update" disabled={pending} onAction={onAction} /> : null}
    </section>
  );
}
