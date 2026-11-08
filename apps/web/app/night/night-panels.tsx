"use client";

import { useEffect, useState } from "react";
import type { DeployHistory, LogLine, MetricsHistory, Runbook } from "../../../../packages/contracts/types";

function panelUrl(incidentId: string, panel: string, filters?: Record<string, string>) {
  return `/api/night/panels?${new URLSearchParams({ incident: incidentId, panel, ...filters })}`;
}

function usePanel<T>(url: string, refreshKey?: string) {
  const [data, setData] = useState<T>();
  const [state, setState] = useState<"loading" | "ready" | "failed" | "unavailable">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) {
        setData(undefined);
        setState("unavailable");
        return;
      }
      if (!response.ok) throw new Error("Panel unavailable");
      const result: T = await response.json();
      if (!controller.signal.aborted) {
        setData(result);
        setState("ready");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setState("failed");
    });
    return () => controller.abort();
  }, [url, attempt, refreshKey]);

  return { data, state, reload: () => setAttempt(value => value + 1) };
}

function PanelStatus({ state, hasData, retry }: {
  state: ReturnType<typeof usePanel>["state"]; hasData: boolean; retry: () => void;
}) {
  if (state === "ready") return null;
  if (state === "loading") return <p className="muted" role="status">{hasData ? "Refreshing this panel…" : "Loading this panel…"}</p>;
  return (
    <div className="entry-section">
      <p className="notice" role="alert">{state === "unavailable" ? "This panel is unavailable for the current incident."
        : hasData ? "Refresh failed. Showing the last loaded data." : "This panel is unavailable."}</p>
      <button onClick={retry}>Retry panel</button>
    </div>
  );
}

export function TeamLogs({ incidentId }: { incidentId: string }) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("");
  const [filters, setFilters] = useState({ q: "", severity: "" });
  const [copyNotice, setCopyNotice] = useState("");
  const { data, state, reload } = usePanel<{ lines: LogLine[] }>(panelUrl(incidentId, "logs", filters));

  return (
    <section className="panel" aria-labelledby="logs-title">
      <h2 id="logs-title" tabIndex={-1}>Checkout logs</h2>
      <p className="muted">Latest 60 matching entries from the incident API.</p>
      <form className="filters" onSubmit={event => {
        event.preventDefault();
        const next = query.trim();
        if (next === filters.q && severity === filters.severity) reload();
        else setFilters({ q: next, severity });
      }}>
        <label>Search logs <input type="search" value={query} maxLength={50} onChange={event => setQuery(event.target.value)} /></label>
        <label>Severity
          <select value={severity} onChange={event => setSeverity(event.target.value)}>
            <option value="">All severities</option>
            <option value="ERROR">Error</option><option value="WARN">Warning</option><option value="INFO">Info</option>
          </select>
        </label>
        <button type="submit">Load matching logs</button>
      </form>
      <PanelStatus state={state} hasData={Boolean(data)} retry={reload} />
      <p className="muted" role="status">{copyNotice}</p>
      {state === "ready" && data && !data.lines.length ? <p>No logs match these filters.</p> : null}
      <div className="log-list team-log-list" tabIndex={data?.lines.length ? 0 : undefined} role="region" aria-label="Log results">
        {data?.lines.map((line, index) => (
          <details key={JSON.stringify([line.time, line.service, line.message, index])}>
            <summary><span className={`badge ${line.level === "ERROR" ? "danger" : "neutral"}`}>{line.level}</span>{" "}
              <time>{line.time}</time> {line.service}<span className="log-preview">{line.message}</span></summary>
            <pre>{line.message}</pre>
            <button onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${line.time} ${line.level} ${line.service} ${line.message}`);
                setCopyNotice(`Log entry at ${line.time} copied.`);
              } catch {
                setCopyNotice("Clipboard unavailable. You can select and copy the message.");
              }
            }}>Copy log entry</button>
          </details>
        ))}
      </div>
    </section>
  );
}

export function TeamDeploys({ incidentId, status }: { incidentId: string; status: string }) {
  const { data, state, reload } = usePanel<DeployHistory>(panelUrl(incidentId, "deploys"), status);
  return (
    <section className="panel" aria-labelledby="deploys-title">
      <h2 id="deploys-title" tabIndex={-1}>Deploy history</h2>
      <PanelStatus state={state} hasData={Boolean(data)} retry={reload} />
      {data ? <p className="muted">Active version at last load <strong>{data.live_version}</strong></p> : null}
      {data && !data.releases.length ? <p>No releases were returned.</p> : null}
      <ul className="deploy-list">
        {data?.releases.map(release => (
          <li key={release.version}>
            <strong>{release.version}</strong>
            <span>{release.title}</span>
            <span className="muted">{release.day} · {release.at} · {release.author}</span>
            {release.files.length ? <details className="deploy-diff">
              <summary>Inspect {release.version} diff · {release.diff_source === "github" ? "GitHub" : "Scenario fallback"}</summary>
              {release.files.map(file => (
                <div key={file.filename}>
                  <p>{file.filename}</p>
                  <pre><code>{file.patch}</code></pre>
                </div>
              ))}
            </details> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TeamMetricHistory({ incidentId, phase }: { incidentId: string; phase: string }) {
  const { data, state, reload } = usePanel<MetricsHistory>(panelUrl(incidentId, "history"), phase);
  return (
    <details className="metric-data">
      <summary>Incident timeline and metric history</summary>
      <PanelStatus state={state} hasData={Boolean(data)} retry={reload} />
      {data ? <>
        <p className="muted">20-minute window at last load. Samples every 30 seconds.</p>
        <button onClick={reload}>Refresh metric history</button>
        {data.events.length ? <ul className="entry-list">
          {data.events.map(event => <li key={`${event.sim_time}-${event.label}`}><time>{event.sim_time}</time> · {event.label}</li>)}
        </ul> : <p>No events in this window.</p>}
        <div className="panel-scroll" tabIndex={0} role="region" aria-label="Historical metric table">
          <table>
            <caption className="sr-only">Incident API metrics history</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Errors</th><th scope="col">Orders/min</th><th scope="col">P95</th></tr></thead>
            <tbody>{data.samples.map(sample => (
              <tr key={sample.sim_time}><td>{sample.sim_time}</td><td>{sample.error_rate}%</td>
                <td>{sample.orders_per_min}</td><td>{sample.p95_ms} ms</td></tr>
            ))}</tbody>
          </table>
        </div>
      </> : null}
    </details>
  );
}

export function TeamRunbooks({ incidentId }: { incidentId: string }) {
  const { data, state, reload } = usePanel<{ runbooks: Pick<Runbook, "name" | "title">[] }>(panelUrl(incidentId, "runbook"));
  const [selected, setSelected] = useState("");
  return (
    <section className="panel" aria-labelledby="runbook-title">
      <h2 id="runbook-title" tabIndex={-1}>Runbooks</h2>
      <PanelStatus state={state} hasData={Boolean(data)} retry={reload} />
      {data && !data.runbooks.length ? <p>No runbooks were returned.</p> : null}
      <div className="actions">
        {data?.runbooks.map(book => (
          <button key={book.name} aria-pressed={selected === book.name} onClick={() => setSelected(book.name)}>{book.title}</button>
        ))}
      </div>
      {selected ? <RunbookSteps key={selected} incidentId={incidentId} name={selected} /> : null}
    </section>
  );
}

function RunbookSteps({ incidentId, name }: { incidentId: string; name: string }) {
  const { data, state, reload } = usePanel<Runbook>(panelUrl(incidentId, "runbook", { name }));
  return (
    <>
      <PanelStatus state={state} hasData={Boolean(data)} retry={reload} />
      {data ? <ol className="entry-list" aria-label={data.title}>{data.steps.map(step => <li key={step}>{step}</li>)}</ol> : null}
    </>
  );
}
