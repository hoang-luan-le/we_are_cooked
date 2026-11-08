#!/usr/bin/env python3
"""Run the current Incident Lab phase on Tung's fork and stop for PM review."""

import fcntl
import json
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
BOARD_TITLE = "Incident Lab Frontend Agent Board"
MODEL_KEYS = (
    "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
)
TRACKING = "+refs/heads/*:refs/remotes/origin/*"
LANES = {
    "CODEX": ("branch-codex", "reports/codex.md", ("apps/web/",),
              None),
    "ARGON": ("branch-argon", "reports/argon.md", ("design/frontend/",),
              ["agy", "--model", "gemini-4-argon-high", "-p"]),
    "CLAUDE": ("branch-claude", "reports/claude.md", ("apps/web/", "design/frontend/"),
               ["claude", "--print", "--model", "claude-opus-5-5", "--permission-mode", "acceptEdits"]),
}


def git(*args, cwd=None, check=True, input_text=None):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=check, text=True, stdout=subprocess.PIPE,
        stderr=None if check else subprocess.DEVNULL, input=input_text
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
        if role == "CODEX" and field(lane, "Mode") not in {"CLOUD", "WEB"}:
            raise ValueError("CODEX must use Mode: CLOUD or WEB")
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


def cli(*args, cwd=None, strip=True):
    output = subprocess.run(
        args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE, timeout=120
    ).stdout
    return output.strip() if strip else output


def prepare_board():
    cli("gh", "auth", "status", "--hostname", "github.com")
    repo = json.loads(cli("gh", "repo", "view", FORK, "--json", "hasIssuesEnabled"))
    if not repo["hasIssuesEnabled"]:
        raise RuntimeError("Enable Issues on the fork under Settings > General > Features, then restart.")
    issues = json.loads(cli(
        "gh", "issue", "list", "--repo", FORK, "--state", "open",
        "--json", "number,title", "--limit", "100"
    ))
    matches = [str(issue["number"]) for issue in issues if issue["title"] == BOARD_TITLE]
    if len(matches) > 1:
        raise RuntimeError("More than one open Agent Board matches. Keep one open and restart.")
    if matches:
        return matches[0]
    issue_url = cli(
        "gh", "issue", "create", "--repo", FORK, "--title", BOARD_TITLE, "--body",
        "Frontend phase handoffs. PHASE_CONTROL.md on the fork's main controls execution. "
        "This public board records status, report links and command IDs. Tung reviews each "
        "completed phase and decides when to merge and open the next one."
    )
    match = re.fullmatch(rf"https://github\.com/{re.escape(FORK)}/issues/(\d+)", issue_url)
    if not match:
        raise RuntimeError("GitHub did not return an issue URL. Inspect Issues before restarting.")
    issue = match[1]
    try:
        cli("gh", "issue", "pin", issue, "--repo", FORK)
    except (subprocess.SubprocessError, OSError):
        print(f"Board created at {issue_url}. Pin it from GitHub if needed.", flush=True)
    return issue


def board_post(issue, event, body):
    marker = f"<!-- incident-lab:{event} -->"
    data = json.loads(cli("gh", "issue", "view", issue, "--repo", FORK, "--json", "comments"))
    if any(marker in comment["body"] for comment in data["comments"]):
        return
    url = cli("gh", "issue", "comment", issue, "--repo", FORK, "--body", f"{body}\n\n{marker}")
    print(url, flush=True)


def run_cloud(main, branch, base, remote, task, prompt, checkout, state_dir):
    if not shutil.which("codex"):
        raise RuntimeError("Install Codex CLI and sign in with ChatGPT before running CLOUD mode.")
    if "chatgpt" not in cli("codex", "login", "status").lower():
        raise RuntimeError("Sign in to Codex CLI with ChatGPT for CLOUD mode.")
    cloud_help = cli("codex", "cloud", "--help")
    if not all(re.search(rf"^\s+{name}\b", cloud_help, re.M) for name in ("exec", "status", "diff")):
        raise RuntimeError("Update Codex CLI to a version with cloud exec, status and diff.")
    if "--branch" not in cli("codex", "cloud", "exec", "--help"):
        raise RuntimeError("Update Codex CLI to a version with cloud exec --branch.")
    env_id = os.environ.get("INCIDENT_CODEX_ENV")
    if not env_id:
        raise RuntimeError("Set INCIDENT_CODEX_ENV to the published Codex Cloud environment for this fork.")
    state_path = state_dir / f"{task}.json"
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state["base"] != base or state["environment"] != env_id:
            raise RuntimeError(f"Cloud task {task} has a different base or environment. Check {state_path}.")
        if not state["url"]:
            raise RuntimeError(f"Cloud submission for {task} is uncertain. Check Codex Cloud before issuing a new ID.")
    else:
        check_main(main)
        if remote != base:
            git("push", "--no-follow-tags", "origin", f"{base}:refs/heads/{branch}", cwd=checkout)
        state_dir.mkdir(exist_ok=True)
        state = {"base": base, "environment": env_id, "url": None}
        # Record the attempt before sending it, so ambiguous submissions never auto-repeat.
        state_path.write_text(json.dumps(state))
        output = cli("codex", "cloud", "exec", "--env", env_id, "--branch", branch, prompt, cwd=checkout)
        matches = re.findall(r"^https://chatgpt\.com/codex/tasks/[A-Za-z0-9_-]+$", output, re.M)
        if len(matches) != 1:
            raise RuntimeError(f"Cloud task URL could not be confirmed. Check Codex Cloud for {task}.")
        state["url"] = matches[0]
        temporary = state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state))
        temporary.replace(state_path)
    url = state["url"]
    print(f"{task}: {url}", flush=True)
    deadline = time.monotonic() + 2700
    while True:
        check_main(main)
        status = cli("codex", "cloud", "status", url, cwd=checkout)
        if re.search(r"^\[(READY|APPLIED)\]", status, re.M):
            break
        if re.search(r"^\[ERROR\]", status, re.M):
            raise RuntimeError(f"Codex Cloud reported an error for {task}. Review {url}.")
        if not re.search(r"^\[PENDING\]", status, re.M):
            raise RuntimeError(f"Could not recognize Codex Cloud status for {task}. Review {url}.")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f"Codex Cloud still running for {task}. Restart to resume {url}.")
        time.sleep(min(20, remaining))
    diff = cli("codex", "cloud", "diff", url, cwd=checkout, strip=False)
    if not diff:
        raise RuntimeError(f"Codex Cloud returned no changes for {task}. Review {url}.")
    git("apply", "--check", "-", cwd=checkout, input_text=diff)
    git("apply", "-", cwd=checkout, input_text=diff)


def run_lane(main, previous, role, task, lane, rules, state_dir):
    branch, report, prefixes, command = LANES[role]
    tip_ref = f"refs/remotes/origin/{branch}"
    cloud = role == "CODEX" and field(lane, "Mode") == "CLOUD"
    if role == "CODEX" and not cloud:
        return wait_for_codex(main, previous, branch, tip_ref, task, report)
    remote = git("rev-parse", "--verify", "--quiet", tip_ref, check=False).stdout.strip()
    ready = published_report(remote, previous, role, task, report)
    if ready:
        return ready

    check_main(main)
    if command and not shutil.which(command[0]):
        raise RuntimeError(f"{command[0]} is missing. Install and authenticate it on the runner.")
    checkout = Path(tempfile.mkdtemp(prefix=f"incident-{role.lower()}-"))
    print(f"Running {task} in {checkout}", flush=True)
    git("worktree", "add", "--quiet", "--detach", str(checkout), remote or main)
    git("merge", "--no-edit", main, cwd=checkout)
    git("merge", "--no-edit", previous, cwd=checkout)
    base = git("rev-parse", "HEAD", cwd=checkout).stdout.strip()
    allowed = () if field(lane, "Mode", "WRITE") == "REPORT_ONLY" else prefixes
    scope = ", ".join((*allowed, report))
    prompt = f"""Complete only {task} for {FORK} on branch {branch}.
The phase runner handles Git fetch, merge, commit and push. Do not do those operations,
change branches, start another agent, open a PR, post an issue comment, or write outside {scope}.
Your task is based on commit {base}. Stop if your checkout is different.
The checkout already contains the previous lane's verified commit.
Write {report}. Its first two lines must be STATUS: READY_FOR_REVIEW or STATUS: BLOCKED,
then COMMAND_ID: {task}. Use headings ### A., ### B. and ### C. for the teaching report.
State real evidence, findings and limits, including fixture versus live API verification.
End with a teach-back question and a verification step. Keep public content safe.

{rules}

Current assignment:
{lane}"""
    if cloud:
        run_cloud(main, branch, base, remote, task, prompt, checkout, state_dir)
    else:
        run_agent(command, prompt, checkout)
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


def main(phase=None):
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
        if any(os.environ.get(key) for key in MODEL_KEYS):
            raise ValueError("Use account sign-in. Unset model API key or token overrides before running.")
        for program in ("gh", "git"):
            if not shutil.which(program):
                raise RuntimeError(f"Install {program} before starting.")
        issue = prepare_board()
        print(f"Agent Board: https://github.com/{FORK}/issues/{issue}", flush=True)
        last_control = None
        while True:
            try:
                git("fetch", "--quiet", "--prune", "origin", TRACKING)
                main_commit = git("rev-parse", "origin/main").stdout.strip()
                control_id = git("rev-parse", f"{main_commit}:PHASE_CONTROL.md").stdout.strip()
                if phase or control_id != last_control:
                    last_control = control_id
                    control = git("show", f"{main_commit}:PHASE_CONTROL.md").stdout
                    current = field(control, "Phase hiện tại").split()[0]
                    if phase or field(control, "Trạng thái chung") == "IN_PROGRESS":
                        run_phase(main_commit, phase or current, control, issue, common.resolve())
                    else:
                        print(f"Phase {current}: waiting for PM authorization.", flush=True)
            except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
                if phase:
                    raise
                print(f"Phase stopped: {error}", file=sys.stderr, flush=True)
            if phase:
                return
            time.sleep(20)


def run_phase(main_commit, phase, control, issue, common):
    queue = read_queue(control, phase)
    rules = git("show", f"{main_commit}:AGENTS.md").stdout
    previous = main_commit
    reports = []
    for index, (role, task, lane) in enumerate(queue):
        next_role = queue[index + 1][0].lower() if index + 1 < len(queue) else "tung"
        try:
            previous, report = run_lane(main_commit, previous, role, task, lane, rules, common / "incident-cloud")
        except (ValueError, RuntimeError, OSError, subprocess.SubprocessError):
            try:
                board_post(issue, f"{task}:{main_commit}:blocked",
                           f"From: runner\nTo: tung\nTask: {task}\nStatus: BLOCKED\n\n"
                           "The phase stopped at this task. Check the runner output before issuing a retry.")
            except (ValueError, OSError, subprocess.SubprocessError) as error:
                print(f"Could not post to Agent Board: {error}", file=sys.stderr, flush=True)
            raise
        link = f"https://github.com/{FORK}/blob/{previous}/{report}"
        reports.append(link)
        board_post(issue, f"{task}:{previous}:review",
                   f"From: {role.lower()}\nTo: {next_role}\nTask: {task}\nStatus: REVIEW\n\nReport: {link}")
    check_main(main_commit)
    board_post(issue, f"phase-{phase}:{main_commit}:{previous}:ready",
               f"From: runner\nTo: tung\nTask: PHASE-{phase}\nStatus: REVIEW\n\n"
               "PHASE READY_FOR_REVIEW. Review bugs and the teaching reports before opening another phase.\n\n"
               + "\n".join(f"- {link}" for link in reports))
    print("PHASE READY_FOR_REVIEW. Waiting for PM approval.", flush=True)
    print("\n".join(reports), flush=True)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or not (sys.argv[1] == "--watch" or re.fullmatch(r"[0-9]{2}", sys.argv[1])):
            raise ValueError("Usage: python3 tools/run-phase.py --watch  (or pass a phase such as 01)")
        main(None if sys.argv[1] == "--watch" else sys.argv[1])
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(f"Phase stopped: {error}", file=sys.stderr)
        sys.exit(1)
