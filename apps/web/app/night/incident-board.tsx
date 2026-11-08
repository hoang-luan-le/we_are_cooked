"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { DEPLOYS, HISTORY, LOGS, RECOVERY, RECOVERY_LOG, type MetricSample } from "./fixture";
import type { NightAction, NightSnapshot } from "./use-night-api";

const [currentDeploy, rollbackDeploy] = DEPLOYS;

function Trend({ title, samples, field, max, suffix }: {
  title: string;
  samples: readonly MetricSample[];
  field: "errorRate" | "ordersPerMinute";
  max: number;
  suffix: string;
}) {
  const sampleCount = HISTORY.length + RECOVERY.length;
  const points = samples.map((sample, index) => ({
    x: 28 + 278 * index / (sampleCount - 1),
    y: 78 - 64 * sample[field] / max,
  }));
  const latest = points[points.length - 1];
  const current = samples[samples.length - 1][field];

  return (
    <figure className="trend">
      <figcaption>
        <span>{title}</span>
        <strong>{current}<span>{suffix}</span></strong>
      </figcaption>
      <svg viewBox="0 0 320 91" aria-hidden="true" focusable="false">
        {[14, 46, 78].map(y => <line className="chart-grid" key={y} x1="28" x2="306" y1={y} y2={y} />)}
        <text x="0" y="18">{max}</text>
        <text x="0" y="82">0</text>
        <polyline className={field === "errorRate" ? "chart-line error-line" : "chart-line"} points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
        <circle className={field === "errorRate" ? "chart-dot error-dot" : "chart-dot"} cx={latest.x} cy={latest.y} r="4" />
      </svg>
    </figure>
  );
}

function CheckoutLogs({ recovered, api }: { recovered: boolean; api: boolean }) {
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const logs = (recovered ? [RECOVERY_LOG, ...LOGS] : LOGS).filter(log =>
    (level === "all" || log.level === level) && `${log.summary} ${log.detail}`.toLowerCase().includes(search)
  );

  return (
    <section className="panel" aria-labelledby="logs-title">
      <div className="section-title">
        <h2 id="logs-title" tabIndex={-1}>Checkout logs</h2>
        <span className="muted">{logs.length} {logs.length === 1 ? "entry" : "entries"}</span>
      </div>
      {api ? <p className="muted">Scenario log samples</p> : null}
      <div className="filters">
        <label>Search logs <input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Severity <select value={level} onChange={event => setLevel(event.target.value)}>
          <option value="all">All severities</option><option value="error">Error</option><option value="info">Info</option>
        </select></label>
      </div>
      {logs.length ? (
        <div className="log-list">
          {logs.map(log => (
            <details key={log.id}>
              <summary><span className={`badge ${log.level === "error" ? "danger" : "neutral"}`}>{log.level}</span>{" "}
                <time>{log.time}</time>{" "}{log.summary}</summary>
              <pre>{log.detail}</pre>
            </details>
          ))}
        </div>
      ) : <p role="status">No logs match these filters.</p>}
    </section>
  );
}

function DeployHistory({ activeVersion, api }: { activeVersion: string; api: boolean }) {
  return (
    <section className="panel" aria-labelledby="deploys-title">
      <h2 id="deploys-title" tabIndex={-1}>Deploy history</h2>
      {api ? <p className="muted">Scenario release details</p> : null}
      <ul className="deploy-list">
        {DEPLOYS.map(deploy => (
          <li key={deploy.version}>
            <span><strong>{deploy.version}</strong> <span className="muted">{deploy.time}</span></span>
            <span>{deploy.title}</span>
            {deploy.version === activeVersion ? <span className="badge neutral">Active deploy</span> : null}
          </li>
        ))}
      </ul>
      <details className="deploy-diff">
        <summary>Inspect {currentDeploy.version} fixture diff</summary>
        <pre><code>{"checkout/pricing.py\n+ tier = customer.profile[\"tier\"]\n+ discount = LOYALTY_DISCOUNTS[tier]"}</code></pre>
      </details>
    </section>
  );
}

function LockedPanel({ title, id, pending, onOpen }: {
  title: string; id: string; pending: boolean; onOpen: () => void;
}) {
  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <button disabled={pending} onClick={onOpen}>Open {title.toLowerCase()}</button>
    </section>
  );
}

function recoveryStep(startedAt: number) {
  let remaining = Date.now() - startedAt;
  for (let index = 0; index < RECOVERY.length; index++) {
    remaining -= RECOVERY[index].delay;
    if (remaining < 0) return index;
  }
  return RECOVERY.length;
}

export function IncidentBoard({ heading, snapshot, pending, finalCaption, onAction, initialRollbackAt = null, onFixtureRollback, teamMode = false }: {
  heading: RefObject<HTMLHeadingElement | null>;
  snapshot?: NightSnapshot;
  pending: boolean;
  finalCaption?: string;
  onAction: (intent: NightAction) => Promise<boolean>;
  initialRollbackAt?: number | null;
  onFixtureRollback?: (startedAt: number) => void;
  teamMode?: boolean;
}) {
  const [step, setStep] = useState(() => initialRollbackAt === null ? null : recoveryStep(initialRollbackAt));
  const rollbackStart = useRef(initialRollbackAt);
  const dialog = useRef<HTMLDialogElement>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const incident = snapshot?.incident;
  const recovering = incident ? incident.phase === "mitigating" : step !== null && step < RECOVERY.length;
  const recovered = incident ? !recovering && incident.status !== "broken" : step === RECOVERY.length;
  const status = recovering ? "Recovering" : recovered ? "Recovered" : "Degraded";
  const canRollback = incident ? incident.allowed_actions.includes("rollback") && !pending : step === null;
  const discounts = incident ? incident.loyalty_discounts === "on" : !recovered;
  const activeVersion = incident?.status === "fixed" ? "Fix deployed" :
    (incident?.status === "rolled_back" || recovered) ? rollbackDeploy.version : currentDeploy.version;
  const samples = snapshot?.samples ?? [...HISTORY, ...RECOVERY.slice(0, step ?? 0)];
  const latest = samples[samples.length - 1];
  const canOpenPanel = !pending && incident?.allowed_actions.includes("open_panel");

  async function openPanel(panel: "dashboard" | "logs" | "deploys", headingId: string) {
    if (await onAction({ action: "open_panel", panel })) {
      window.requestAnimationFrame(() => document.getElementById(headingId)?.focus());
    }
  }

  useEffect(() => {
    const startedAt = rollbackStart.current;
    if (startedAt === null || step === null || step >= RECOVERY.length) return;
    if (step === 0) statusHeading.current?.focus();
    const nextOffset = RECOVERY.slice(0, step + 1).reduce((elapsed, point) => elapsed + point.delay, 0);
    const delay = Math.max(0, startedAt + nextOffset - Date.now());
    const timer = window.setTimeout(() => setStep(Math.max(step + 1, recoveryStep(startedAt))), delay);
    return () => window.clearTimeout(timer);
  }, [step]);

  return (
    <>
      <section className="board-heading">
        <p className="eyebrow">Night 2D · ShopNorth</p>
        <h1 ref={heading} tabIndex={-1}>Checkout incident</h1>
        <p>Compare the checkout errors and deploy timing to decide which release to roll back.</p>
        {snapshot ? <p className="muted">Last API response <time dateTime={new Date(snapshot.receivedAt).toISOString()}>
          {new Date(snapshot.receivedAt).toLocaleTimeString()}
        </time></p> : null}
        {finalCaption ? <p><strong>Dana</strong> {finalCaption}</p> : null}
      </section>
      <div className="board-grid">
        {incident && !incident.unlocked.includes("dashboard") ? (
          <LockedPanel title="Service metrics" id="metrics-title" pending={!canOpenPanel}
            onOpen={() => void openPanel("dashboard", "metrics-title")} />
        ) : (
        <section className="panel metrics-panel" aria-labelledby="metrics-title">
          <div className="section-title">
            <h2 id="metrics-title" tabIndex={-1}>Service metrics</h2>
            <span className="muted">{incident ? "API simulation clock" : "Simulated update"} <time>{latest.time}</time></span>
          </div>
          <div className="trends">
            <Trend title="Checkout error rate" samples={samples} field="errorRate" max={40} suffix="%" />
            <Trend title="Successful orders" samples={samples} field="ordersPerMinute" max={500} suffix="/min" />
          </div>
          <details className="metric-data">
            <summary>Read chart values <span className="muted">· Sample order</span></summary>
            <table>
              <caption className="sr-only">Simulated checkout metrics by sample time</caption>
              <thead><tr><th scope="col">Time</th><th scope="col">Errors</th><th scope="col">Orders/min</th></tr></thead>
              <tbody>{samples.map((sample, index) => (
                <tr key={index}><td>{sample.time}</td><td>{sample.errorRate}%</td><td>{sample.ordersPerMinute}</td></tr>
              ))}</tbody>
            </table>
          </details>
        </section>
        )}
        <section className="panel" aria-labelledby="mitigation-title">
          <div className="section-title">
            <h2 id="mitigation-title" ref={statusHeading} tabIndex={-1}>Mitigation</h2>
            <span className={`badge ${recovered ? "success" : recovering ? "neutral" : "danger"}`} role="status">{status}</span>
          </div>
          <dl className="service-facts">
            <div><dt>Active version</dt><dd>{activeVersion}</dd></div>
            <div><dt>Loyalty discounts</dt><dd>{discounts ? "On" : "Off"}</dd></div>
          </dl>
          <p>{recovered ? "Checkout metrics returned to baseline." : recovering ? "Watch checkout errors fall as the previous release returns." : "Return to the last stable release. Loyalty discounts will be disabled."}</p>
          <button className="primary" disabled={!canRollback} onClick={() => dialog.current?.showModal()}>
            Roll back to {rollbackDeploy.version}
          </button>
          <dialog ref={dialog} aria-labelledby="rollback-title" aria-describedby="rollback-description">
            <h2 id="rollback-title">Roll back to {rollbackDeploy.version}?</h2>
            <p id="rollback-description">This switches checkout from {currentDeploy.version} to {rollbackDeploy.version} and turns off loyalty discounts in this simulation.</p>
            <form method="dialog" className="actions" onSubmit={event => {
              event.preventDefault();
              dialog.current?.close();
              if (!canRollback) return;
              if (incident) {
                void onAction({ action: "rollback" }).then(accepted => {
                  if (accepted) statusHeading.current?.focus();
                });
              } else if (rollbackStart.current === null) {
                const startedAt = Date.now();
                rollbackStart.current = startedAt;
                onFixtureRollback?.(startedAt);
                setStep(0);
              }
            }}>
              <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
              <button type="submit" className="primary" disabled={!canRollback}>Confirm rollback</button>
            </form>
          </dialog>
        </section>
        {incident && !incident.unlocked.includes("logs") ? (
          <LockedPanel title="Checkout logs" id="logs-title" pending={!canOpenPanel}
            onOpen={() => void openPanel("logs", "logs-title")} />
        ) : teamMode ? <section className="panel" aria-labelledby="logs-title">
          <h2 id="logs-title" tabIndex={-1}>Checkout logs</h2>
          <p className="muted">The team API has not supplied role-specific log entries.</p>
        </section> : <CheckoutLogs recovered={!incident && recovered} api={Boolean(incident)} />}
        {incident && !incident.unlocked.includes("deploys") ? (
          <LockedPanel title="Deploy history" id="deploys-title" pending={!canOpenPanel}
            onOpen={() => void openPanel("deploys", "deploys-title")} />
        ) : teamMode ? <section className="panel" aria-labelledby="deploys-title">
          <h2 id="deploys-title" tabIndex={-1}>Deploy history</h2>
          <p className="muted">The team API has not supplied role-specific release details.</p>
        </section> : <DeployHistory activeVersion={activeVersion} api={Boolean(incident)} />}
      </div>
    </>
  );
}
