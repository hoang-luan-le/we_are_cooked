import type { DisplayContent } from "../../world/world-display";

// One beat drives the panel, Dana's caption and the projector. Nothing here reads an answer key.
export const NOT_REVIEWED = "Not reviewed overnight.";

export type MeetingInput = {
  source: string;
  handoff: { by: string; at: string; whatHappened: string; currentState: string; tried: string; risks: string } | null;
  recovered: boolean;
  discounts: string;
  findings: { by: string; text: string }[];
  impact: { peakErrorRate: number; lowestOrders: number; baselineErrorRate: number; baselineOrders: number } | null;
  release: { version: string; at: string; title: string } | null;
  errorLog: string | null;
};

export type Assignment = {
  role: "Author" | "Reviewer";
  desk: "desk-1" | "desk-2";
  workstation: string;
  at: readonly [number, number];
  task: string;
  checks: string[];
  source: string;
};

export type Beat = { id: string; title: string; caption: string; lines: string[] };

export const authorFixture: Assignment = {
  role: "Author", desk: "desk-1", workstation: "Workstation 1", at: [4.5, 9.2],
  task: "Reproduce the guest checkout failure, write the permanent fix in VS Code, and open the pull request on GitHub.",
  checks: ["The failing case has a regression test", "CI passes on the pull request", "A teammate reviews it before deploy"],
  source: "Fixture assignment",
};

export const reviewerFixture: Assignment = {
  role: "Reviewer", desk: "desk-2", workstation: "Workstation 2", at: [4.7, 8.2],
  task: "Review your teammate's pull request on GitHub. Check the behavior and the tests, then leave a substantive review.",
  checks: ["You are not the pull request author", "CI passes on the pull request", "Your review explains what you checked"],
  source: "Fixture assignment",
};

export function buildBeats(input: MeetingInput, assignment: Assignment | null): Beat[] {
  const { handoff, impact, release, errorLog, findings } = input;
  const noHandoff = "The Night handoff has not been written yet.";
  return [
    {
      id: "what-happened", title: "What happened",
      caption: handoff ? `Thanks for coming in. ${handoff.by} wrote this up at ${handoff.at}. Here's what the night shift saw.` : "Thanks for coming in. We don't have the night shift's write-up yet.",
      lines: [handoff?.whatHappened ?? noHandoff],
    },
    {
      id: "impact", title: "Impact on customers",
      caption: impact ? "This is how bad it got." : "We don't have the numbers from overnight, so treat this part as unknown.",
      lines: impact ? [
        `Checkout errors peaked at ${impact.peakErrorRate}%, up from ${impact.baselineErrorRate}%.`,
        `Orders fell to ${impact.lowestOrders} a minute, from ${impact.baselineOrders}.`,
      ] : [NOT_REVIEWED],
    },
    {
      id: "evidence", title: "What the evidence shows",
      caption: release || errorLog || findings.length ? "Let's stick to what was actually observed." : "Nobody recorded evidence overnight.",
      lines: [
        release ? `Release ${release.version} went out at ${release.at}: ${release.title}.` : `Deploy history: ${NOT_REVIEWED}`,
        errorLog ? `Error log: ${errorLog}` : `Logs: ${NOT_REVIEWED}`,
        ...findings.slice(0, 2).map(finding => `${finding.by} noted: ${finding.text}`),
      ],
    },
    {
      id: "recovery", title: "What restored checkout",
      caption: handoff ? "Here's how the night team stopped the damage." : "We can only report the current incident state.",
      lines: [
        handoff?.tried ?? noHandoff,
        handoff?.currentState ?? (input.recovered ? "The incident reports checkout has recovered." : "The incident does not report recovery."),
        `Loyalty discounts are ${input.discounts}.`,
      ],
    },
    {
      id: "uncertain", title: "Known and still uncertain",
      caption: "The rollback bought us time. It didn't fix anything, so be clear about what we don't know yet.",
      lines: [
        release && errorLog ? `Known: errors followed release ${release.version}.` : `Known: ${NOT_REVIEWED}`,
        "Still uncertain: the exact cause. Confirm it in the code before changing anything.",
        `Remaining risk: ${handoff?.risks ?? noHandoff}`,
      ],
    },
    assignment ? {
      id: "assignment", title: `Your assignment: ${assignment.role}`,
      caption: `You're the ${assignment.role} on the permanent fix. Head to ${assignment.workstation}.`,
      lines: [assignment.task, `Go to ${assignment.workstation}.`],
    } : {
      id: "assignment", title: "Next: the permanent fix",
      caption: "That's the review. The permanent fix is separate work, so head to a workstation and open the Morning workspace.",
      lines: ["Go to a workstation and open the Morning workspace.", "It shows what your account can do on this incident."],
    },
  ];
}

export function beatDisplay(beat: Beat, index: number, total: number, source: string): DisplayContent {
  return { eyebrow: `Incident review ${index + 1} of ${total}`, title: beat.title, lines: beat.lines, footer: "Dana is presenting", badge: source };
}
