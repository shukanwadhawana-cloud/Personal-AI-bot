#!/usr/bin/env python3
"""Regression tests for task-acceptance-gate.py

Run: python .github/scripts/test_task_acceptance_gate.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

GATE_PATH = Path(__file__).resolve().parent / "task-acceptance-gate.py"


def load_gate():
    spec = importlib.util.spec_from_file_location("task_acceptance_gate", GATE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


gate = load_gate()


class AcceptanceGateTests(unittest.TestCase):
    def test_e2e_test_txt_task_must_pass(self):
        """Current failing production case: only e2e-test.txt created."""
        prompt = (
            "Add a file named `e2e-test.txt` containing exactly:\n\n"
            "Personal AI Bot E2E test passed\n\n"
            "Do not modify anything else.\n\n"
            "Repository: shukanwadhawana-cloud/Personal-AI-bot\n"
            "Follow the verification/acceptance process carefully."
        )
        changed = ["e2e-test.txt"]
        contents = {"e2e-test.txt": "Personal AI Bot E2E test passed\n"}
        passed, reasons, diag = gate.evaluate(
            prompt, changed, file_contents=contents
        )
        self.assertTrue(passed, msg=f"expected PASS, got FAIL: {reasons} diag={diag}")
        self.assertNotIn("shukanwadhawana-cloud/Personal-AI-bot", diag["required_paths"])
        self.assertNotIn("verification/acceptance", diag["required_paths"])
        self.assertIn("e2e-test.txt", diag["required_paths"])

    def test_gitignore_only_must_fail(self):
        """Housekeeping-only change despite implementation request."""
        prompt = (
            "Create an API route handler for /api/health that returns JSON status ok. "
            "Implement the feature properly."
        )
        changed = [".gitignore"]
        passed, reasons, diag = gate.evaluate(prompt, changed)
        self.assertFalse(passed, msg="gitignore-only must FAIL")
        self.assertTrue(
            any("housekeeping" in r.lower() or "only housekeeping" in r.lower() for r in reasons)
            or any("implementation work" in r for r in reasons),
            msg=reasons,
        )

    def test_owner_repo_not_required_path(self):
        prompt = (
            "Repository: owner/repo\n"
            "Add a file named hello.txt containing exactly: hi\n"
        )
        changed = ["hello.txt"]
        contents = {"hello.txt": "hi\n"}
        passed, reasons, diag = gate.evaluate(
            prompt, changed, file_contents=contents
        )
        self.assertNotIn("owner/repo", diag["required_paths"])
        self.assertNotIn("owner/repo", diag["missing"])
        self.assertTrue(passed, msg=reasons)

    def test_verification_acceptance_phrase_not_required_path(self):
        prompt = (
            "Follow the verification/acceptance process. "
            "Create notes.md with a short summary."
        )
        changed = ["notes.md"]
        contents = {"notes.md": "summary\n"}
        passed, reasons, diag = gate.evaluate(
            prompt, changed, file_contents=contents
        )
        self.assertNotIn("verification/acceptance", diag["required_paths"])
        self.assertNotIn("verification/acceptance", diag["missing"])
        self.assertTrue(passed, msg=reasons)

    def test_exact_content_mismatch_fails(self):
        prompt = (
            "Add a file named `e2e-test.txt` containing exactly:\n"
            "Personal AI Bot E2E test passed\n"
        )
        changed = ["e2e-test.txt"]
        contents = {"e2e-test.txt": "wrong content\n"}
        passed, reasons, diag = gate.evaluate(
            prompt, changed, file_contents=contents
        )
        self.assertFalse(passed, msg="wrong exact content must FAIL")
        self.assertTrue(any("Exact content" in r for r in reasons), msg=reasons)

    def test_explicit_src_path_required(self):
        prompt = "Create the file src/utils/helpers.ts with a noop export."
        changed = ["README.md"]
        passed, reasons, diag = gate.evaluate(prompt, changed)
        self.assertFalse(passed)
        self.assertIn("src/utils/helpers.ts", diag["missing"])

    def test_noop_empty_fails(self):
        prompt = "Create a file named feature.txt containing exactly: done"
        passed, reasons, diag = gate.evaluate(prompt, [])
        self.assertFalse(passed)
        self.assertTrue(any("No repository changes" in r for r in reasons))


if __name__ == "__main__":
    # Ensure we can also import/run the gate CLI help path.
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(AcceptanceGateTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
