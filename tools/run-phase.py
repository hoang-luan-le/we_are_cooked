#!/usr/bin/env python3
"""Run the current Incident Lab phase on Tung's fork and stop for PM review."""

import fcntl
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time


FORK = "thanhtungnguyen-dev/we_are_cooked"
LANES = {
    "CODEX": ("branch-codex", "reports/codex.md", ("apps/web/",),
              None),
    "ARGON": ("branch-argon", "reports/argon.md", ("design/frontend/",),
              ["agy", "--model", "gemini-4-argon-high", "-p"]),
    "CLAUDE": ("branch-claude", "reports/claude.md", ("apps/web/", "design/frontend/"),
               ["claude", "--print", "--model", "claude-opus-5-5", "--permission-mode", "acceptEdits"]),
}


def git(*args, cwd=None, check=True):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=check, text=True, stdout=subprocess.PIPE,
        stderr=None if check else subprocess.DEVNULL
    )


def field(text, label, default=None):
    match = re.search(rf"^- \*\*{re.escape(label)}:\*\* (.+)$", text, re.M)
    if not match:
        if default is not None:
            return default
        raise ValueError(f"Missing {label} in PHASE_CONTROL.md")
    return match[1].strip("` ")


def read_queue(control, phase):
    header, *sections = re.split(r"^## ", control, flags=re.M)
    if field(header, "Phase hiện tại").split()[0] != phase:
        raise ValueError(f"main does not authorize phase {phase}")
    if field(header, "Trạng thái chung") != "IN_PROGRESS":
        raise ValueError("Set the phase to IN_PROGRESS on the fork to launch it")
    if field(header, "Agent chỉnh file") != "RUNNER":
        raise ValueError("Set Agent chỉnh file to RUNNER")
    sections = dict((section.splitlines()[0].split()[0], section) for section in sections)
    queue_text = next((s for s in sections.values() if s.startswith("Hàng đợi tự động\n")), "")
    queue = re.findall(r"^\d+\. ([A-Z]+)$", queue_text, re.M)
    if not queue or len(queue) != len(set(queue)) or any(role not in LANES for role in queue):
        raise ValueError("Queue must list each active lane once")
    commands = []
    for role in queue:
        lane = sections.get(role, "")
        task = field(lane, "Command-ID")
        if field(lane, "Status") not in {"WORKING", "FIX_REQUIRED"}:
            raise ValueError(f"{role} is not authorized to run")
        if not re.fullmatch(rf"{phase}-{role}-[A-Z0-9-]+", task):
            raise ValueError(f"Invalid command ID for {role}: {task}")
        if role == "CODEX" and field(lane, "Mode") != "WEB":
            raise ValueError("CODEX must use Mode: WEB")
        commands.append((role, task, lane))
    return commands


def prior_status(text, task):
    lines = text.splitlines()
    if len(lines) < 2 or not lines[0].startswith("STATUS: ") or lines[1] != f"COMMAND_ID: {task}":
        return None
    return lines[0].removeprefix("STATUS: ")


def run_agent(command, prompt, directory):
    with subprocess.Popen([*command, prompt], cwd=directory, start_new_session=True) as process:
        try:
            code = process.wait(timeout=2700)
        except (KeyboardInterrupt, subprocess.TimeoutExpired):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    if code:
        raise RuntimeError(f"{command[0]} exited with code {code}")


def check_main(expected):
    git("fetch", "--quiet", "origin", "refs/heads/main")
    if git("rev-parse", "FETCH_HEAD").stdout.strip() != expected:
        raise RuntimeError("Fork main changed. Check the current phase before restarting.")


def published_report(remote, previous, role, task, report):
    if not remote:
        return None
    result = git("show", f"{remote}:{report}", check=False)
    if result.returncode:
        return None
    status = prior_status(result.stdout, task)
    if status == "BLOCKED":
        raise RuntimeError(f"{task} is blocked. Read {report} on {LANES[role][0]} and issue a new Command-ID.")
    if status == "READY_FOR_REVIEW":
        if any(f"### {letter}." not in result.stdout for letter in "ABC"):
            raise RuntimeError(f"{task} report lacks a teaching section")
        git("merge-base", "--is-ancestor", previous, remote)
        return remote, report
    return None


def wait_for_codex(main, previous, branch, tip_ref, task, report):
    print(f"Waiting for Codex Web: publish {task} on {branch} with {report}.", flush=True)
    deadline = time.monotonic() + 2700
    while True:
        check_main(main)
        git("fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*")
        if git("rev-parse", "origin/main").stdout.strip() != main:
            raise RuntimeError("Fork main changed. Check the current phase before restarting.")
        tip = git("rev-parse", "--verify", "--quiet", tip_ref, check=False).stdout.strip()
        ready = published_report(tip, previous, "CODEX", task, report)
        if ready:
            paths = git("diff", "--name-only", "--no-renames", "-z", previous, tip).stdout.split("\0")
            if any(path and path != report and not path.startswith("apps/web/") for path in paths):
                raise RuntimeError(f"{task} contains out-of-scope changes. Review {branch} before continuing.")
            print(f"{task}: READY_FOR_REVIEW https://github.com/{FORK}/blob/{tip}/{report}", flush=True)
            return ready
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f"Timed out waiting for {task}. Restart after the Codex Web commit is published.")
        time.sleep(min(30, remaining))


def run_lane(main, previous, role, task, lane, rules):
    branch, report, prefixes, command = LANES[role]
    tip_ref = f"refs/remotes/origin/{branch}"
    if role == "CODEX":
        return wait_for_codex(main, previous, branch, tip_ref, task, report)
    remote = git("rev-parse", "--verify", "--quiet", tip_ref, check=False).stdout.strip()
    ready = published_report(remote, previous, role, task, report)
    if ready:
        return ready

    check_main(main)
    if not shutil.which(command[0]):
        raise RuntimeError(f"{command[0]} is missing. Install and authenticate it on the runner.")
    checkout = Path(tempfile.mkdtemp(prefix=f"incident-{role.lower()}-"))
    print(f"Running {task} in {checkout}", flush=True)
    git("worktree", "add", "--quiet", "--detach", str(checkout), remote or main)
    git("merge", "--no-edit", main, cwd=checkout)
    git("merge", "--no-edit", previous, cwd=checkout)
    base = git("rev-parse", "HEAD", cwd=checkout).stdout.strip()
    allowed = () if field(lane, "Mode", "WRITE") == "REPORT_ONLY" else prefixes
    scope = ", ".join((*allowed, report))
    run_agent(
        command,
        f"""Complete only {task} in the supplied worktree.
The phase runner handles Git fetch, merge, commit and push. Do not do those operations,
change branches, start another agent, open a PR, or write outside {scope}.
The worktree already contains the previous lane's verified commit. Report-only mode
limits changes to the report. Complete your own checks in the scope of the task.
Write {report}. Its first two lines must be STATUS: READY_FOR_REVIEW or STATUS: BLOCKED,
then COMMAND_ID: {task}. Use headings ### A., ### B. and ### C. for the teaching report.
State real evidence, findings and limits, including fixture versus live API verification.
End with a teach-back question and a verification step. Keep public content safe.

{rules}

Current assignment:
{lane}""",
        checkout,
    )
    if (git("rev-parse", "HEAD", cwd=checkout).stdout.strip() != base
            or git("symbolic-ref", "--quiet", "HEAD", cwd=checkout, check=False).returncode != 1):
        raise RuntimeError(f"{task} changed Git history in {checkout}")
    if not (checkout / report).is_file() or (checkout / report).is_symlink():
        raise RuntimeError(f"{task} did not write a valid report. Inspect {checkout}.")
    content = (checkout / report).read_text()
    status = prior_status(content, task)
    if status not in {"READY_FOR_REVIEW", "BLOCKED"}:
        raise RuntimeError(f"{task} report has an invalid status or command ID. Inspect {checkout}.")
    if status == "READY_FOR_REVIEW" and any(f"### {letter}." not in content for letter in "ABC"):
        raise RuntimeError(f"{task} report lacks a teaching section. Inspect {checkout}.")
    git("add", "-A", cwd=checkout)
    paths = git("diff", "--cached", "--name-only", "--no-renames", "-z", cwd=checkout).stdout.split("\0")
    paths = [path for path in paths if path]
    if report not in paths or any(path != report and not path.startswith(allowed) for path in paths):
        raise RuntimeError(f"{task} staged missing or out-of-scope changes. Inspect {checkout}.")
    git("diff", "--cached", "--check", cwd=checkout)
    check_main(main)
    git("commit", "-m", f"phase {task}: {status.lower()}", cwd=checkout)
    commit = git("rev-parse", "HEAD", cwd=checkout).stdout.strip()
    git("push", "--no-follow-tags", "origin", f"{commit}:refs/heads/{branch}", cwd=checkout)
    actual = git("ls-remote", "origin", f"refs/heads/{branch}").stdout.split()
    if not actual or actual[0] != commit:
        raise RuntimeError(f"Could not verify {task} on GitHub. Inspect {checkout}.")
    git("worktree", "remove", "--force", str(checkout))
    print(f"{task}: {status} https://github.com/{FORK}/blob/{commit}/{report}", flush=True)
    if status == "BLOCKED":
        raise RuntimeError(f"{task} is blocked. No later lane was launched.")
    return commit, report


def main(phase):
    origins = git("config", "--get-all", "remote.origin.url").stdout.splitlines()
    push_urls = git("config", "--get-all", "remote.origin.pushurl", check=False).stdout.splitlines()
    allowed = {f"https://github.com/{FORK}", f"git@github.com:{FORK}", f"ssh://git@github.com/{FORK}"}
    if len(origins) != 1 or len(push_urls) > 1 or any(
        url.removesuffix(".git") not in allowed for url in origins + push_urls
    ):
        raise ValueError(f"Run this only in a checkout of {FORK}")
    common = Path(git("rev-parse", "--git-common-dir").stdout.strip())
    with (common / "incident-phase.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        git("fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*")
        main_commit = git("rev-parse", "origin/main").stdout.strip()
        control = git("show", f"{main_commit}:PHASE_CONTROL.md").stdout
        rules = git("show", f"{main_commit}:AGENTS.md").stdout
        previous = main_commit
        reports = []
        for role, task, lane in read_queue(control, phase):
            previous, report = run_lane(main_commit, previous, role, task, lane, rules)
            reports.append(f"https://github.com/{FORK}/blob/{previous}/{report}")
        check_main(main_commit)
        print("PHASE READY_FOR_REVIEW. Review the reports and the combined changes before opening another phase.")
        print("\n".join(reports))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or not re.fullmatch(r"[0-9]{2}", sys.argv[1]):
            raise ValueError("Usage: python3 tools/run-phase.py 01")
        main(sys.argv[1])
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(f"Phase stopped: {error}", file=sys.stderr)
        sys.exit(1)
