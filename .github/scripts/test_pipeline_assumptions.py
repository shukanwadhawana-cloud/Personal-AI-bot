#!/usr/bin/env python3
"""Static self-test of critical PAI Worker pipeline assumptions.

Does not call LLMs or GitHub Actions. Run:
  python .github/scripts/test_pipeline_assumptions.py
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / ".github" / "workflows" / "pai-worker.yml"
GATE = ROOT / ".github" / "scripts" / "task-acceptance-gate.py"


class PipelineAssumptionTests(unittest.TestCase):
    def setUp(self):
        self.worker = WORKER.read_text(encoding="utf-8")

    def test_worker_file_exists(self):
        self.assertTrue(WORKER.is_file())

    def test_gate_file_exists(self):
        self.assertTrue(GATE.is_file())

    def test_checkout_uses_workspace(self):
        self.assertIn("path: workspace", self.worker)
        self.assertIn("actions/checkout@v4", self.worker)

    def test_execute_in_workspace(self):
        self.assertIn("working-directory: workspace", self.worker)

    def test_aider_not_no_git(self):
        self.assertNotIn("--no-git", self.worker)

    def test_aider_no_auto_commits(self):
        self.assertIn("--no-auto-commits", self.worker)

    def test_worker_owns_commit_push(self):
        self.assertIn("git commit", self.worker)
        self.assertIn("git push", self.worker)

    def test_gate_loaded_from_github_sha(self):
        self.assertIn(
            "task-acceptance-gate.py?ref=${{ github.sha }}", self.worker
        )

    def test_no_gold_worker_in_worker_file(self):
        self.assertNotIn("gold-worker.yml", self.worker)

    def test_diagnostics_present(self):
        self.assertIn("repository diagnostics", self.worker)
        self.assertIn("git rev-parse --show-toplevel", self.worker)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PipelineAssumptionTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
