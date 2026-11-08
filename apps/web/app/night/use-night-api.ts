"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionRequest, ActionResponse, HandoffRequest, IncidentState } from "../../../../packages/contracts/types";
import type { MetricSample } from "./fixture";

export type NightAction =
  | { action: "answer" | "snooze" | "rollback" | "deploy_fix" }
  | { action: "share_finding" | "status_update"; text: string }
  | { action: "open_panel"; panel: "dashboard" | "logs" | "deploys" | "runbook" };

export type NightIncident = Omit<IncidentState, "ringing"> & { ringing?: boolean };
export type NightSnapshot = {
  incident: NightIncident;
  samples: MetricSample[];
  receivedAt: number;
  newFindingFrom?: number;
};

export function useNightApi(enabled: boolean, incidentId?: string) {
  const path = incidentId ? `/api/night?incident=${encodeURIComponent(incidentId)}` : "/api/night";
  const [snapshot, setSnapshot] = useState<NightSnapshot>();
  const [readFailure, setReadFailure] = useState<"access" | "unavailable">();
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const [retryAction, setRetryAction] = useState<NightAction>();
  const active = useRef<{ controller: AbortController; write: boolean }>(null);
  const keys = useRef(new Map<string, string>());

  const show = useCallback((incident: NightIncident) => {
    const receivedAt = Date.now();
    const sample = {
      time: incident.sim_clock,
      errorRate: incident.metrics.error_rate,
      ordersPerMinute: incident.metrics.orders_per_min,
    };
    setSnapshot(previous => {
      const last = previous?.samples.at(-1);
      const same = last?.time === sample.time && last.errorRate === sample.errorRate &&
        last.ordersPerMinute === sample.ordersPerMinute;
      const reset = previous?.incident.phase !== "paged" && incident.phase === "paged";
      const samples = reset ? [sample] : same && previous ? previous.samples : [...(previous?.samples ?? []), sample].slice(-7);
      const oldCount = previous?.incident.findings.length;
      const newFindingFrom = reset || oldCount === undefined || incident.findings.length < oldCount ? undefined
        : incident.findings.length > oldCount ? oldCount : previous?.newFindingFrom;
      return { incident, samples, receivedAt, newFindingFrom };
    });
    setReadFailure(undefined);
  }, []);

  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = { controller, write: false };
    try {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (incidentId && [401, 403, 404].includes(response.status)) {
        keys.current.clear();
        setSnapshot(undefined);
        setActionError("");
        setRetryAction(undefined);
        setReadFailure("access");
        return;
      }
      if (!response.ok) throw new Error("Incident unavailable");
      const incident: NightIncident = await response.json();
      if (!controller.signal.aborted) show(incident);
    } catch {
      if (!controller.signal.aborted) setReadFailure(current => current === "access" ? current : "unavailable");
    } finally {
      if (active.current?.controller === controller) active.current = null;
    }
  }, [incidentId, path, show]);

  useEffect(() => {
    if (!enabled) return;
    void read();
    const interval = window.setInterval(read, 2000);
    return () => {
      window.clearInterval(interval);
      active.current?.controller.abort();
      active.current = null;
    };
  }, [enabled, read]);

  function refresh() {
    if (active.current?.write) return;
    active.current?.controller.abort();
    active.current = null;
    void read();
  }

  async function act(intent: NightAction) {
    if (active.current?.write) return false;
    active.current?.controller.abort();
    const controller = new AbortController();
    active.current = { controller, write: true };
    setPending(true);
    const isNote = "text" in intent;
    if (!isNote) {
      setActionError("");
      setRetryAction(undefined);
    }

    const actionName = intent.action === "open_panel" ? JSON.stringify([intent.action, intent.panel])
      : isNote ? JSON.stringify([intent.action, intent.text]) : intent.action;
    const previousKey = keys.current.get(actionName);
    let refresh = false;
    try {
      const idempotencyKey = previousKey ?? crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
      keys.current.set(actionName, idempotencyKey);
      const body: ActionRequest = { ...intent, idempotency_key: idempotencyKey };
      const response = await fetch(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (controller.signal.aborted) return false;
      if (response.status >= 500) throw new Error("Action result unavailable");
      if (!response.ok) {
        keys.current.delete(actionName);
        refresh = true;
        if (!isNote) setActionError(response.status === 409
          ? "The incident changed before this action was accepted. Check the current state."
          : "The API did not accept this action. Check the demo member configuration.");
        return false;
      }
      const result: ActionResponse = await response.json();
      if (controller.signal.aborted) return false;
      keys.current.delete(actionName);
      // A replay may contain the original, older snapshot. Read the current state instead.
      if (previousKey) refresh = true;
      else show(result.state);
      return true;
    } catch {
      if (!controller.signal.aborted) {
        refresh = true;
        if (!isNote) {
          setActionError("The API did not confirm this action. Check the incident or retry the same request.");
          setRetryAction(intent);
        }
      }
      return false;
    } finally {
      if (active.current?.controller === controller) {
        active.current = null;
        setPending(false);
        if (refresh) void read();
      }
    }
  }

  async function saveHandoff(draft: HandoffRequest) {
    if (!incidentId || active.current?.write) return 409;
    active.current?.controller.abort();
    const controller = new AbortController();
    active.current = { controller, write: true };
    setPending(true);
    try {
      const response = await fetch(`/api/night/handoff?incident=${encodeURIComponent(incidentId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft), signal: controller.signal,
      });
      return controller.signal.aborted ? 0 : response.status;
    } catch {
      return controller.signal.aborted ? 0 : 503;
    } finally {
      if (active.current?.controller === controller) {
        active.current = null;
        setPending(false);
        void read();
      }
    }
  }

  return {
    snapshot, refresh, readError: Boolean(readFailure), accessLost: readFailure === "access",
    pending, actionError, retryAction, act, saveHandoff,
  };
}
