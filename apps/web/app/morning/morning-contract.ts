import type { CheckRequest, ConnectionRequest, HandoffRatingRequest } from "../../../../packages/contracts/types";

export type MorningWrite =
  | { operation: "verify"; url: string }
  | { operation: "rate"; score: HandoffRatingRequest["score"]; note: string }
  | { operation: "check"; stage: CheckRequest["stage"]; choice: string; explanation: string }
  | { operation: "connect"; handle: ConnectionRequest["to_user"]; workAgain: boolean }
  | { operation: "debrief"; answer: string };

export function githubPullUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://github.com" || url.username || url.password ||
      !/^\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)) return;
    return `https://github.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return;
  }
}
