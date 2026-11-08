"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionRequest, ActionResponse, IncidentState } from "../../../../packages/contracts/types";
import type { MetricSample } from "./fixture";

export type NightAction =
  | { action: "answer" | "snooze" | "rollback" }
  | { action: "open_panel"; panel: "dashboard" | "logs" | "deploys" };

export type NightSnapshot = { incident: IncidentState; samples: MetricSample[] };

export function useNightApi(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<NightSnapshot>();
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const [retryAction, setRetryAction] = useState<NightAction>();
  const active = useRef<{ controller: AbortController; write: boolean }>(null);
  const keys = useRef(new Map<string, string>());

  const show = useCallback((incident: IncidentState) => {
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
      return { incident, samples };
    });
    setReadError(false);
  }, []);

  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = { controller, write: false };
    try {
      const response = await fetch("/api/night", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Incident unavailable");
      const incident: IncidentState = await response.json();
      if (!controller.signal.aborted) show(incident);
    } catch {
      if (!controller.signal.aborted) setReadError(true);
    } finally {
      if (active.current?.controller === controller) active.current = null;
    }
  }, [show]);

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

  async function act(intent: NightAction) {
    if (active.current?.write) return false;
    active.current?.controller.abort();
    const controller = new AbortController();
    active.current = { controller, write: true };
    setPending(true);
    setActionError("");
    setRetryAction(undefined);

    const actionName = intent.action === "open_panel" ? `open_panel:${intent.panel}` : intent.action;
    const previousKey = keys.current.get(actionName);
    const idempotencyKey = previousKey ?? crypto.randomUUID();
    keys.current.set(actionName, idempotencyKey);
    let refresh = false;
    try {
      const body: ActionRequest = { ...intent, idempotency_key: idempotencyKey };
      const response = await fetch("/api/night", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (controller.signal.aborted) return false;
      if (response.status >= 500) throw new Error("Action result unavailable");
      if (!response.ok) {
        keys.current.delete(actionName);
        refresh = true;
        setActionError(response.status === 409
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
        setActionError("The API did not confirm this action. Check the incident or retry the same request.");
        setRetryAction(intent);
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

  return { snapshot, read, readError, pending, actionError, retryAction, act };
}
