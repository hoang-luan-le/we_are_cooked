"use client";

import { useRef, useState } from "react";
import type { HandoffRequest, IncidentState } from "../../../../packages/contracts/types";

const fields = [
  ["what_happened", "What happened"],
  ["current_state", "Current state"],
  ["tried", "What was tried"],
  ["risks", "Remaining risks"],
] as const;

function payloadKey(note: HandoffRequest) {
  return JSON.stringify([...fields.map(([key]) => note[key]), note.morning_pair ?? []]);
}

export function NightHandoff({ incident, user, unavailable, onSave }: {
  incident: Pick<IncidentState, "phase" | "handoff">;
  user: string;
  unavailable: boolean;
  onSave: (draft: HandoffRequest) => Promise<number>;
}) {
  const [editor, setEditor] = useState<{ version: string; initial: IncidentState["handoff"] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unconfirmedDraft, setUnconfirmedDraft] = useState<string>();
  const [accepted, setAccepted] = useState<{ version: string; payload: string }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const handoff = incident.handoff;
  const currentPayload = handoff ? payloadKey(handoff) : undefined;
  const version = handoff ? JSON.stringify([handoff.by, handoff.sim_clock, currentPayload, handoff.rating]) : "";
  const lateFirstHandoff = !handoff && (incident.phase === "fixed" || incident.phase === "debriefed");
  const phaseAllowsHandoff = incident.phase === "stabilized" || incident.phase === "handed_off" || lateFirstHandoff;
  const editable = phaseAllowsHandoff && (!handoff || (!handoff.rating && handoff.night_pair.includes(user)));
  const changedDuringEdit = editor !== undefined && editor.version !== version;
  const draftAlreadyShared = unconfirmedDraft !== undefined && handoff?.by === user && currentPayload === unconfirmedDraft;
  const awaitingSnapshot = accepted?.version === version && accepted.payload !== currentPayload;

  function closeEditor() {
    setEditor(undefined);
    setUnconfirmedDraft(undefined);
    setError("");
    heading.current?.focus();
  }

  if (!phaseAllowsHandoff && !handoff && !editor) return null;

  return (
    <section className="panel evidence-panel" aria-labelledby="handoff-title">
      <h2 id="handoff-title" ref={heading} tabIndex={-1}>Shift handoff</h2>
      {handoff ? (
        <>
          <p className="muted">Saved by {handoff.by} at {handoff.sim_clock}</p>
          <dl className="handoff-parts">
            {fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{handoff[key]}</dd></div>)}
            {handoff.morning_pair.length ? <div><dt>Morning teammates</dt><dd>{handoff.morning_pair.join(", ")}</dd></div> : null}
          </dl>
        </>
      ) : <p>Write a short note for the next shift about the incident and what still needs work.</p>}
      {notice ? <p role="status">{notice}</p> : null}
      {editable && !editor ? (
        <button disabled={unavailable || awaitingSnapshot} onClick={() => {
          setNotice("");
          setEditor({ version, initial: handoff });
        }}>
          {handoff ? "Edit shift handoff" : "Write shift handoff"}
        </button>
      ) : null}
      {editor ? (
        <form className="entry-section" onChange={() => setUnconfirmedDraft(undefined)} onSubmit={async event => {
          event.preventDefault();
          if (saving || unavailable || !editable || changedDuringEdit || draftAlreadyShared) return;
          const form = new FormData(event.currentTarget);
          const part = (key: string) => String(form.get(key) ?? "").trim();
          const handles = part("morning_pair").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
          if (handles.length > 4 || handles.some(handle => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(handle))) {
            setError("Enter up to four demo handles, separated by commas.");
            return;
          }
          const body: HandoffRequest = {
            what_happened: part("what_happened"), current_state: part("current_state"),
            tried: part("tried"), risks: part("risks"), morning_pair: Array.from(new Set(handles)),
          };
          if (fields.some(([key]) => !body[key])) {
            setError("Complete all four parts of the handoff.");
            return;
          }
          setSaving(true);
          setError("");
          setUnconfirmedDraft(undefined);
          const payload = payloadKey(body);
          const status = await onSave(body);
          if (!status) return;
          setSaving(false);
          if (status === 204) {
            setAccepted({ version, payload });
            setNotice("Shift handoff saved.");
            closeEditor();
          } else if (status === 401 || status === 403 || status === 404) {
            setError("The API did not authorize this member to write the handoff.");
          } else if (status === 409) {
            setError("The incident changed. Check its recovery or handoff status, then try again.");
          } else if (status === 422) {
            setError("Check that each part has text and any morning handles exist.");
          } else {
            setUnconfirmedDraft(payload);
            setError("The API did not confirm the handoff. Check the shared note before retrying.");
          }
        }}>
          {fields.map(([key, label]) => (
            <label key={key}>{label}
              <textarea autoFocus={key === "what_happened"} name={key} rows={2} required maxLength={1000} readOnly={saving} defaultValue={editor.initial?.[key]} />
            </label>
          ))}
          <label>Morning teammate handles (optional)
            <input name="morning_pair" maxLength={140} autoComplete="off" readOnly={saving}
              defaultValue={editor.initial?.morning_pair.join(", ")} />
          </label>
          {!editable ? <p className="notice">The current incident state prevents edits.</p> : null}
          {draftAlreadyShared ? <p className="notice" role="status">Your draft is already in the shared handoff.</p>
            : changedDuringEdit ? <p className="notice" role="status">The shared handoff changed. Review the latest note above before saving.</p>
            : error ? <p className="notice" role="alert">{error}</p> : null}
          <div className="actions">
            {draftAlreadyShared ? <button type="button" onClick={closeEditor}>Close saved draft</button> : null}
            {changedDuringEdit && !draftAlreadyShared && editable ? (
              <button type="button" disabled={saving || unavailable} onClick={() => {
                setEditor({ ...editor, version });
                setError("");
              }}>Keep my draft and allow save</button>
            ) : null}
            <button className="primary" disabled={saving || unavailable || !editable || changedDuringEdit || draftAlreadyShared}>
              {saving ? "Saving handoff…" : "Save shift handoff"}
            </button>
            <button type="button" disabled={saving} onClick={closeEditor}>Cancel handoff edit</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
