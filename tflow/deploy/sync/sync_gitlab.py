"""Transfer only new GitHub changes through a tested GitLab MR to Spirit.

The source marker survives GitLab's mandatory squash. This avoids replaying old
GitHub edits over newer GitLab work. Conflicts stop the workflow; no force push
or automatic choice of ours/theirs is permitted.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

API_URL = "https://gitlab.t-education.com/api/v4/projects/465"
REPOSITORY = "https://gitlab.t-education.com/hack-mmk-25/tflow.git"
TARGET = "master"
MARKER = re.compile(r"^TFLOW-GitHub-Source: ([0-9a-f]{40})$", re.M)


class SyncError(RuntimeError):
    pass


class ApiError(SyncError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"GitLab API returned HTTP {status}; credentials and response withheld")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitLab:
    def __init__(self, token):
        self.token = token
        self.http = build_opener(NoRedirect())

    def request(self, method, path, data=None):
        request = Request(API_URL + path, method=method,
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={"PRIVATE-TOKEN": self.token, "Content-Type": "application/json"})
        try:
            with self.http.open(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            raise ApiError(error.code) from None
        except (URLError, TimeoutError):
            raise SyncError("GitLab connection failed; rerun safely to resume the same source branch") from None


def git(*args, cwd=None, env=None, input=None, check=True):
    result = subprocess.run(["git", *args], cwd=cwd, env=env, input=input,
                            capture_output=True, timeout=120)
    if check and result.returncode:
        raise SyncError(f"git {args[0]} failed; refusing to discard or overwrite conflicting changes")
    return result


def source_marker(commits):
    for commit in commits:
        match = MARKER.search(commit["message"])
        if match:
            return match.group(1)
    return None


def synchronized_source(repo, target):
    # Read the fetched history rather than a single API page: maintenance
    # commits must not hide the baseline after the first 100 changes.
    message = git("log", target, "--format=%B", "--grep=^TFLOW-GitHub-Source:", "-1", cwd=repo).stdout.decode()
    return source_marker([{"message": message}])


def baseline_for(repo, target, source, previous):
    baseline = previous or git("merge-base", target, source, cwd=repo).stdout.decode().strip()
    if git("merge-base", "--is-ancestor", baseline, source, cwd=repo, check=False).returncode:
        raise SyncError("GitHub history does not contain the previous synchronized source; manual reconciliation required")
    return baseline


def apply_delta(repo, baseline, source, target, env):
    patch = git("diff", "--binary", baseline, source, cwd=repo, env=env).stdout
    git("checkout", "--detach", target, cwd=repo, env=env)
    if patch:
        git("apply", "--3way", "--index", "-", cwd=repo, env=env, input=patch)
    message = f"Sync reviewed GitHub main {source[:12]}\n\nTFLOW-GitHub-Source: {source}\n"
    git("commit", "--allow-empty", "-m", message, cwd=repo, env=env)
    return git("rev-parse", "HEAD", cwd=repo).stdout.decode().strip()


def await_merge(api, mr, repo, env, branch, source, deadline):
    while time.monotonic() < deadline:
        current = api.request("GET", f"/merge_requests/{mr['iid']}")
        if current["state"] == "merged":
            return current.get("squash_commit_sha") or current["merge_commit_sha"]
        if current["state"] != "opened" or current.get("has_conflicts"):
            raise SyncError(f"MR !{mr['iid']} needs human conflict resolution; no changes were discarded")
        pipeline = current.get("head_pipeline") or {}
        if pipeline.get("sha") == current.get("sha") and pipeline.get("status") in {"failed", "canceled"}:
            raise SyncError(f"GitLab checks failed for MR !{mr['iid']}; deployment blocked")
        if current.get("detailed_merge_status") == "need_rebase":
            git("fetch", "tflow-gitlab", TARGET, cwd=repo, env=env)
            git("merge", "--no-ff", "--no-edit", "FETCH_HEAD", cwd=repo, env=env)
            git("push", "tflow-gitlab", f"HEAD:refs/heads/{branch}", cwd=repo, env=env)
            time.sleep(10)
            continue
        if not current.get("merge_when_pipeline_succeeds"):
            sha = git("rev-parse", "HEAD", cwd=repo).stdout.decode().strip()
            try:
                api.request("PUT", f"/merge_requests/{mr['iid']}/merge", {
                    "sha": sha, "auto_merge": True, "merge_when_pipeline_succeeds": True,
                    "squash": True, "should_remove_source_branch": False,
                    "squash_commit_message": f"Sync GitHub main {source[:12]}\n\nTFLOW-GitHub-Source: {source}\n",
                })
            except ApiError as error:
                if error.status not in {405, 409}:
                    raise
                # Read state again before another mutation; checks may still be initializing.
        time.sleep(10)
    raise SyncError(f"Timed out waiting for MR !{mr['iid']}; inspect its pipeline before rerunning")


def await_deployment(api, commit, deadline):
    while time.monotonic() < deadline:
        pipelines = api.request("GET", "/pipelines?" + urlencode({"sha": commit, "ref": TARGET}))
        for pipeline in pipelines:
            if pipeline.get("status") in {"failed", "canceled"}:
                raise SyncError(f"Production pipeline {pipeline['id']} failed; Spirit release is not verified")
            jobs = api.request("GET", f"/pipelines/{pipeline['id']}/jobs?per_page=100")
            for job in jobs:
                if job["name"] != "deploy-spirit-cu":
                    continue
                if job["status"] == "success":
                    if job.get("commit", {}).get("id") != commit:
                        raise SyncError("Deployment job identifies a different commit")
                    return job
                if job["status"] in {"failed", "canceled", "manual", "skipped"}:
                    raise SyncError(f"Spirit deploy job {job['id']} is {job['status']}; automatic release did not complete")
        time.sleep(10)
    raise SyncError("Timed out waiting for the exact Spirit deployment; the sync is not marked successful")


def main():
    source = os.environ.get("TFLOW_GITHUB_SOURCE_SHA", "")
    token = os.environ.get("TFLOW_GITLAB_TOKEN", "").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", source) or not token:
        raise SyncError("Set TFLOW_GITHUB_SOURCE_SHA and the TFLOW_GITLAB_TOKEN repository secret")
    repo = Path(__file__).resolve().parents[3]
    tip = git("ls-remote", "origin", "refs/heads/main", cwd=repo).stdout.decode().split()[0]
    if tip != source:
        print("A newer GitHub main push is already queued; skipping this superseded source")
        return
    api = GitLab(token)
    deadline = time.monotonic() + 1800
    with tempfile.TemporaryDirectory(prefix="tflow-sync-") as directory:
        helper = Path(directory) / "askpass.py"
        helper.write_text("#!/usr/bin/env python3\nimport os,sys\nprint('oauth2' if 'username' in sys.argv[1].lower() else os.environ['TFLOW_GITLAB_TOKEN'])\n")
        helper.chmod(0o700)
        env = {**os.environ, "TFLOW_GITLAB_TOKEN": token, "GIT_ASKPASS": str(helper), "GIT_TERMINAL_PROMPT": "0",
               "GIT_AUTHOR_NAME": "TFlow CI", "GIT_COMMITTER_NAME": "TFlow CI",
               "GIT_AUTHOR_EMAIL": "ci@tflow.invalid", "GIT_COMMITTER_EMAIL": "ci@tflow.invalid"}
        existing = git("remote", "get-url", "tflow-gitlab", cwd=repo, check=False)
        if existing.returncode:
            git("remote", "add", "tflow-gitlab", REPOSITORY, cwd=repo)
        elif existing.stdout.decode().strip() != REPOSITORY:
            raise SyncError("Unexpected GitLab remote; refusing to send credentials")
        git("fetch", "tflow-gitlab", TARGET, cwd=repo, env=env)
        target = git("rev-parse", "FETCH_HEAD", cwd=repo).stdout.decode().strip()
        previous = synchronized_source(repo, target)
        branch = f"sync/github-{source}"
        matches = api.request("GET", "/merge_requests?" + urlencode({"source_branch": branch, "target_branch": TARGET, "state": "all"}))
        mr = next((item for item in matches if item["state"] in {"opened", "merged"}), None)
        if previous == source:
            merged = target
        elif mr and mr["state"] == "merged":
            merged = mr.get("squash_commit_sha") or mr["merge_commit_sha"]
        else:
            if mr:
                git("fetch", "tflow-gitlab", branch, cwd=repo, env=env)
                git("checkout", "--detach", "FETCH_HEAD", cwd=repo, env=env)
            else:
                baseline = baseline_for(repo, target, source, previous)
                try:
                    stored = api.request("GET", "/repository/branches/" + quote(branch, safe=""))
                except ApiError as error:
                    if error.status != 404:
                        raise
                    stored = None
                if stored:
                    git("fetch", "tflow-gitlab", branch, cwd=repo, env=env)
                    git("checkout", "--detach", "FETCH_HEAD", cwd=repo, env=env)
                    marker = MARKER.search(git("log", "-1", "--format=%B", cwd=repo).stdout.decode())
                    if not marker or marker.group(1) != source:
                        raise SyncError("Existing synchronization branch does not identify this source")
                else:
                    apply_delta(repo, baseline, source, target, env)
                # A timeout after push is safe to resume: the branch identifies this immutable source.
                git("push", "tflow-gitlab", f"HEAD:refs/heads/{branch}", cwd=repo, env=env)
                mr = api.request("POST", "/merge_requests", {
                    "source_branch": branch, "target_branch": TARGET,
                    "title": f"Sync reviewed GitHub main {source[:12]}",
                    "description": f"GitHub CI passed for https://github.com/DertyuGameDev/ProdMurm2026/commit/{source}. Only the delta since the last synchronized GitHub commit is applied. Conflicts block synchronization.",
                    "remove_source_branch": False,
                })
            print(f"Waiting for GitLab checks and MR !{mr['iid']}", flush=True)
            merged = await_merge(api, mr, repo, env, branch, source, deadline)
        print(f"GitLab release {merged}; waiting for automatic Spirit deployment", flush=True)
        job = await_deployment(api, merged, deadline)
        print(f"GitHub {source} → GitLab {merged} → Spirit job {job['id']}: success", flush=True)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as stream:
                stream.write(f"GitHub `{source}` → GitLab `{merged}` → [verified Spirit deploy]({job['web_url']}).\n")


if __name__ == "__main__":
    try:
        main()
    except SyncError as error:
        raise SystemExit(str(error)) from None
