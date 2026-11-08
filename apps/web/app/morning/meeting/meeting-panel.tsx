"use client";

import { useEffect, useRef } from "react";
import { type Beat, NOT_REVIEWED } from "./meeting-script";

export function MeetingPanel({ beats, index, source, complete, onIndex, onFinish }: {
  beats: Beat[]; index: number; source: string; complete: boolean;
  onIndex: (index: number) => void; onFinish: () => void;
}) {
  const beat = beats[index];
  const heading = useRef<HTMLHeadingElement>(null);
  const last = index === beats.length - 1;
  useEffect(() => { heading.current?.focus(); }, [index]);

  return (
    <main className="meeting" aria-label="Incident review meeting">
      <p><span className="badge fixture">{source} · Scripted dialogue</span></p>
      <p className="eyebrow">Incident review · {index + 1} of {beats.length}</p>
      <h1 ref={heading} tabIndex={-1}>{beat.title}</h1>
      <p className="meeting-caption" role="status" aria-label="Dana's caption"><strong>Dana</strong> {beat.caption}</p>
      <ul className="meeting-lines">
        {beat.lines.map(line => <li key={line} className={line.includes(NOT_REVIEWED) ? "meeting-missing" : undefined}>{line}</li>)}
      </ul>
      <div className="actions">
        <button disabled={index === 0} onClick={() => onIndex(index - 1)}>Back</button>
        {last
          ? <button className="primary" onClick={onFinish}>{complete ? "Return to the office" : "Finish the meeting"}</button>
          : <button className="primary" onClick={() => onIndex(index + 1)}>Next</button>}
        {!last ? <button onClick={() => onIndex(beats.length - 1)}>Skip to the next objective</button> : null}
      </div>
    </main>
  );
}
