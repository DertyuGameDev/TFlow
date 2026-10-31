import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock

from sync_gitlab import SyncError, apply_delta, await_deployment, baseline_for, git, source_marker, synchronized_source


class DeltaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        self.env = {**os.environ, "GIT_AUTHOR_NAME":"Test", "GIT_AUTHOR_EMAIL":"test@example.test",
                    "GIT_COMMITTER_NAME":"Test", "GIT_COMMITTER_EMAIL":"test@example.test"}
        self.run_git("init", "-b", "github")
        (self.repo / "app").write_text("base\n")
        self.base = self.commit("base")

    def run_git(self, *args):
        return git(*args, cwd=self.repo, env=self.env).stdout.decode().strip()

    def commit(self, name):
        self.run_git("add", ".")
        self.run_git("commit", "-m", name)
        return self.run_git("rev-parse", "HEAD")

    def test_only_new_github_delta_is_applied_and_gitlab_work_is_preserved(self):
        (self.repo / "app").write_text("new GitHub code\n")
        source = self.commit("github update")
        self.run_git("checkout", "--detach", self.base)
        (self.repo / "gitlab-only").write_text("keep this configuration\n")
        target = self.commit("GitLab maintenance")
        self.assertEqual(baseline_for(self.repo, target, source, self.base), self.base)
        apply_delta(self.repo, self.base, source, target, self.env)
        self.assertEqual((self.repo / "app").read_text(), "new GitHub code\n")
        self.assertEqual((self.repo / "gitlab-only").read_text(), "keep this configuration\n")
        self.assertIn("TFLOW-GitHub-Source: " + source, self.run_git("log", "-1", "--format=%B"))

    def test_next_update_survives_squashed_history_without_replaying_previous_code(self):
        (self.repo / "app").write_text("first version\n")
        previous_source = self.commit("first GitHub update")
        (self.repo / "app").write_text("second version\n")
        source = self.commit("second GitHub update")
        self.run_git("checkout", "--detach", self.base)
        (self.repo / "app").write_text("first version\n")
        (self.repo / "gitlab-only").write_text("retained\n")
        target = self.commit("squashed first release")
        apply_delta(self.repo, previous_source, source, target, self.env)
        self.assertEqual((self.repo / "app").read_text(), "second version\n")
        self.assertEqual((self.repo / "gitlab-only").read_text(), "retained\n")

    def test_conflicts_stop_without_committing_over_another_edit(self):
        (self.repo / "app").write_text("GitHub edit\n")
        source = self.commit("github")
        self.run_git("checkout", "--detach", self.base)
        (self.repo / "app").write_text("different GitLab edit\n")
        target = self.commit("gitlab")
        with self.assertRaises(SyncError):
            apply_delta(self.repo, self.base, source, target, self.env)
        self.assertEqual(self.run_git("rev-parse", "HEAD"), target)
        self.assertTrue(self.run_git("diff", "--name-only", "--diff-filter=U"))

    def test_bootstrap_uses_shared_baseline_when_gitlab_advanced_before_first_sync(self):
        self.assertEqual(baseline_for(self.repo, self.base, self.base, None), self.base)
        (self.repo / "app").write_text("not yet in GitHub\n")
        foreign = self.commit("foreign")
        self.assertEqual(baseline_for(self.repo, foreign, self.base, None), self.base)
        with self.assertRaises(SyncError):
            baseline_for(self.repo, foreign, self.base, foreign)

    def test_maintenance_commits_do_not_hide_the_last_github_source(self):
        (self.repo / "synced").write_text("reviewed GitHub changes\n")
        marker = self.commit("sync\n\nTFLOW-GitHub-Source: " + self.base)
        (self.repo / "maintenance").write_text("new configuration\n")
        target = self.commit("maintenance after synchronization")
        self.assertNotEqual(marker, target)
        self.assertEqual(synchronized_source(self.repo, target), self.base)


class CompletionTests(unittest.TestCase):
    def test_marker_is_read_from_the_latest_synchronized_commit(self):
        self.assertEqual(source_marker([{"message":"maintenance"}, {"message":"release\n\nTFLOW-GitHub-Source: " + "a"*40}]), "a"*40)
        self.assertIsNone(source_marker([{"message":"TFLOW-GitHub-Source: invalid"}]))

    def test_success_requires_the_exact_automatic_vm_job(self):
        api = Mock()
        job = {"id":9,"name":"deploy-spirit-cu","status":"success","commit":{"id":"a"*40}}
        api.request.side_effect = [[{"id":8,"status":"success"}], [job]]
        self.assertEqual(await_deployment(api, "a"*40, time.monotonic()+1), job)

    def test_manual_or_failed_deployment_is_not_a_successful_sync(self):
        for status in ["manual", "failed", "canceled", "skipped"]:
            api = Mock()
            api.request.side_effect = [[{"id":8,"status":"success"}], [{"id":9,"name":"deploy-spirit-cu","status":status}]]
            with self.subTest(status=status), self.assertRaises(SyncError):
                await_deployment(api, "a"*40, time.monotonic()+1)

    def test_a_green_job_for_another_commit_cannot_confirm_the_release(self):
        api = Mock()
        api.request.side_effect = [[{"id":8,"status":"success"}], [{"id":9,"name":"deploy-spirit-cu","status":"success","commit":{"id":"b"*40}}]]
        with self.assertRaises(SyncError):
            await_deployment(api, "a"*40, time.monotonic()+1)
