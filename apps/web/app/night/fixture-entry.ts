import type { Level } from "../../../../packages/contracts/dana";

const storageKey = "incident-lab.fixture-entry.v1";

export const levels = {
  explore: { title: "Explore", description: "Use a checklist to work through your first incident." },
  practice: { title: "Practice", description: "Investigate independently with fewer prompts." },
  challenge: { title: "Challenge", description: "Pick your own investigation and recovery plan." },
} as const satisfies Record<Level, { title: string; description: string }>;

export const fixtureCohort = {
  code: "NIGHT24",
  expiredCode: "NIGHT00",
  name: "ShopNorth rehearsal cohort",
  members: [
    { name: "Casey", role: "Night Lead" },
    { name: "You", role: "Night Investigator" },
    { name: "Riley", role: "Morning Author" },
    { name: "Morgan", role: "Morning Reviewer" },
  ],
} as const;

export type FixtureEntry = {
  id: string;
  level: Level;
  kind: "solo" | "cohort";
  answered: boolean;
  briefingPending?: boolean;
  rollbackAt: number | null;
};

export function fixtureEntryHref(id: string) {
  return `/night?fixture=1&entry=${encodeURIComponent(id)}`;
}

export function readFixtureEntry(): FixtureEntry | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const entry: Partial<FixtureEntry> | null = JSON.parse(raw);
    if (!entry || typeof entry.id !== "string" || !/^[a-f0-9]{16}$/.test(entry.id) ||
      (entry.level !== "explore" && entry.level !== "practice" && entry.level !== "challenge") ||
      (entry.kind !== "solo" && entry.kind !== "cohort") || typeof entry.answered !== "boolean" ||
      (entry.briefingPending !== undefined && typeof entry.briefingPending !== "boolean") ||
      (entry.briefingPending && (!entry.answered || entry.rollbackAt !== null)) ||
      (entry.rollbackAt !== null && (!entry.answered || typeof entry.rollbackAt !== "number" ||
        !Number.isFinite(entry.rollbackAt) || entry.rollbackAt < 0))) return null;
    return entry as FixtureEntry;
  } catch {
    return null;
  }
}

export function watchFixtureEntry(refresh: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) refresh();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", refresh);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", refresh);
  };
}

export function startFixtureEntry(level: Level, kind: FixtureEntry["kind"]): FixtureEntry {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, "0")).join("");
  const entry = { id, level, kind, answered: false, rollbackAt: null } satisfies FixtureEntry;
  localStorage.setItem(storageKey, JSON.stringify(entry));
  return entry;
}

type FixtureTransition = { type: "answer" | "finish_briefing" } | { type: "rollback"; startedAt: number };

export function updateFixtureEntry(id: string, transition: FixtureTransition) {
  const current = readFixtureEntry();
  if (current?.id !== id) return false;
  let next: FixtureEntry;
  if (transition.type === "answer" && !current.answered) {
    next = { ...current, answered: true, briefingPending: true };
  } else if (transition.type === "finish_briefing" && current.briefingPending) {
    next = { ...current, briefingPending: false };
  } else if (transition.type === "rollback" && current.answered && !current.briefingPending && current.rollbackAt === null) {
    next = { ...current, rollbackAt: transition.startedAt };
  } else {
    return true;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
