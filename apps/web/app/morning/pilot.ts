import type { DemoConfig } from "../night/demo-config";

/** The team's pilot repo (GET /api/pr/pilot): where the Morning pair fixes the bug. */
export type Pilot = { repo: string; url: string; clone_url: string; base_branch: string };

const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function loadPilot(config: DemoConfig): Promise<Pilot | undefined> {
  try {
    const response = await fetch(new URL("/api/pr/pilot", config.origin), {
      headers: config.headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return;
    const body: Partial<Pilot> & { repo?: string | null } = await response.json();
    // Only ever link to a plain github.com repo URL.
    if (!body.repo || !body.url || !GITHUB_REPO.test(body.url) || body.clone_url !== `${body.url}.git`) return;
    return { repo: body.repo, url: body.url, clone_url: body.clone_url, base_branch: body.base_branch || "main" };
  } catch {
    return;
  }
}
