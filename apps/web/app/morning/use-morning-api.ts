"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MorningWrite } from "./morning-contract";

function path(incident: string, resource?: string) {
  const params = new URLSearchParams({ incident });
  if (resource) params.set("resource", resource);
  return `/api/morning?${params}`;
}

export function useMorningResource<T>(incident: string, resource: "checks" | "evidence" | "connections") {
  const [data, setData] = useState<T>();
  const [status, setStatus] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(undefined);
    void fetch(path(incident, resource), { cache: "no-store", signal: controller.signal }).then(async response => {
      const result: T | undefined = response.ok ? await response.json() : undefined;
      if (controller.signal.aborted) return;
      setData(result);
      setStatus(response.status);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setData(undefined);
      setStatus(503);
    });
    return () => controller.abort();
  }, [incident, resource, attempt]);
  return { data, status, reload };
}

export function useMorningWrite(incident: string) {
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function submit<T = unknown>(body: MorningWrite) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const response = await fetch(path(incident), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!controller.signal.aborted) {
        return { ok: response.ok, status: response.status, code: response.ok ? undefined : result?.code as string | undefined,
          data: response.ok ? result as T : undefined };
      }
    } catch {
      if (!controller.signal.aborted) return { ok: false, status: 503, code: undefined, data: undefined };
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return { busy, submit };
}
