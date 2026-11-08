export type CohortRoster = { id: string; name: string; members: { handle: string }[] };

export function isCohortId(value: unknown): value is string {
  return typeof value === "string" && /^coh_[a-f0-9]{8}$/.test(value);
}

export function isTeamIncidentId(value: unknown): value is string {
  return typeof value === "string" && /^inc_[a-f0-9]{8}$/.test(value);
}

export function teamIncidentHref(id: string) {
  return `/night?incident=${encodeURIComponent(id)}`;
}
