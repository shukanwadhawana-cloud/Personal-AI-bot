#!/usr/bin/env python3
"""Deterministic, non-LLM context selection for PAI agent runs.

Outputs lines:
  MAP_TOKENS=<int>
  FILE=<path>   # editable (--file)
  READ=<path>   # read-only (--read)
  META=<text>

Does not invent paths. Caps initial editable set for large repos.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import List, Set, Tuple

EXCLUDE_DIR_PREFIXES = (
    "node_modules/",
    ".git/",
    ".next/",
    "dist/",
    "build/",
    "coverage/",
    "vendor/",
    ".venv/",
    "venv/",
    "__pycache__/",
    ".tox/",
    ".cache/",
    "target/",
    "out/",
    ".turbo/",
    ".vercel/",
    "pods/",
    "DerivedData/",
)

EXCLUDE_SUFFIXES = (
    ".lock",
    ".lockb",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".mp3",
    ".wasm",
    ".pyc",
    ".so",
    ".dylib",
    ".o",
    ".a",
)

INSTRUCTION_NAMES = (
    "AGENTS.md",
    "CONTRIBUTING.md",
    "REVIEWING.md",
    "README.md",
    "README.rst",
    "README.txt",
    "ARCHITECTURE.md",
    "DEVELOPMENT.md",
)

REF_VERBS = re.compile(
    r"\b(follow|following|read|reading|see|consult|refer(?:ring)?\s+to|"
    r"according\s+to|per|based\s+on|as\s+(?:described|documented|stated)\s+in|"
    r"instructions?\s+in|guidance\s+in)\b",
    re.I,
)
IMPL_VERBS = re.compile(
    r"\b(add|create|implement|build|fix|update|refactor|remove|delete|replace|"
    r"modify|change|make|write)\b",
    re.I,
)
PATH_RE = re.compile(r"[\w./\-]+(?:\.[a-zA-Z0-9]{1,15})?")


def is_excluded(path: str) -> bool:
    p = path.replace("\\", "/").lstrip("./")
    lower = p.lower()
    if any(lower.startswith(x) or f"/{x}" in f"/{lower}" for x in EXCLUDE_DIR_PREFIXES):
        return True
    if any(lower.endswith(s) for s in EXCLUDE_SUFFIXES):
        return True
    parts = lower.split("/")
    if any(part in {"node_modules", ".git", "dist", "build", "coverage", "vendor"} for part in parts):
        return True
    return False


def extract_task_paths(prompt: str) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for m in PATH_RE.finditer(prompt):
        x = m.group(0).strip(".,:;()[]{}\"'`")
        if not x or x.startswith("http") or "github.com" in x:
            continue
        if "/" not in x and "." not in x:
            continue
        if x.count("/") == 1 and not re.search(r"\.[a-zA-Z0-9]+$", x):
            continue
        pre = prompt[max(0, m.start() - 100) : m.start()]
        if REF_VERBS.search(pre):
            refs = list(REF_VERBS.finditer(pre))
            imps = list(IMPL_VERBS.finditer(pre))
            last_ref = refs[-1].start() if refs else -1
            last_impl = imps[-1].start() if imps else -1
            if last_ref > last_impl:
                continue
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def find_instruction_files(root: Path) -> List[str]:
    found: List[str] = []
    for name in INSTRUCTION_NAMES:
        p = root / name
        if p.is_file():
            found.append(name)
        for sub in ("docs", "doc", ".github"):
            p2 = root / sub / name
            if p2.is_file():
                found.append(f"{sub}/{name}")
    return found


def find_related_tests(root: Path, task_paths: List[str], limit: int = 6) -> List[str]:
    out: List[str] = []
    stems: Set[str] = set()
    dirs: Set[str] = set()
    for tp in task_paths:
        p = Path(tp)
        stems.add(p.stem)
        if p.parent.as_posix() not in (".", ""):
            dirs.add(p.parent.as_posix())
        if len(p.parts) > 1:
            dirs.add(p.parts[0])
    candidates: List[tuple] = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        dirnames[:] = [
            d
            for d in dirnames
            if d not in {"node_modules", ".git", "dist", "build", "coverage", "vendor", ".next", ".venv", "venv"}
        ]
        base = rel_dir.lower()
        is_test_dir = any(
            x in base.split("/")
            for x in ("test", "tests", "__tests__", "spec", "specs")
        )
        for fn in filenames:
            full = f"{rel_dir}/{fn}" if rel_dir else fn
            if is_excluded(full):
                continue
            low = full.lower()
            if not is_test_dir and not re.search(r"(test|spec)\.", low):
                continue
            score = 0
            stem = Path(fn).stem.lower()
            for s in stems:
                if s.lower() in stem or stem in s.lower():
                    score += 3
            for d in dirs:
                if d.lower() in low:
                    score += 2
            if score > 0 or (is_test_dir and any(d in low for d in dirs)):
                candidates.append((score, full))
    candidates.sort(key=lambda x: (-x[0], x[1]))
    for _, full in candidates[:limit]:
        out.append(full)
    return out


def map_tokens_for_repo(file_count: int, aggressive: bool) -> int:
    if aggressive:
        return 0
    if file_count >= 400:
        return 128
    if file_count >= 150:
        return 256
    if file_count >= 50:
        return 512
    return 1024


def select(root: Path, prompt: str, *, aggressive: bool = False, max_files: int = 12) -> Tuple[int, List[str], List[str], dict]:
    tracked = []
    try:
        import subprocess

        out = subprocess.run(
            ["git", "ls-files"],
            cwd=str(root),
            text=True,
            capture_output=True,
            check=False,
        ).stdout
        tracked = [ln for ln in out.splitlines() if ln and not is_excluded(ln)]
    except OSError:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
            for fn in filenames:
                full = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                if not is_excluded(full):
                    tracked.append(full)

    file_count = len(tracked)
    task_paths = extract_task_paths(prompt)
    edit: List[str] = []
    for tp in task_paths:
        if (root / tp).is_file() and not is_excluded(tp):
            if tp not in edit:
                edit.append(tp)
        elif (root / tp).is_dir() and not aggressive:
            for dirpath, dirnames, filenames in os.walk(root / tp):
                dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".git"}]
                for fn in filenames:
                    full = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                    if is_excluded(full):
                        continue
                    if full not in edit:
                        edit.append(full)
                    if len(edit) >= max_files:
                        break
                if len(edit) >= max_files:
                    break

    tests = find_related_tests(root, task_paths, limit=4 if aggressive else 6)
    for t in tests:
        if t not in edit and (root / t).is_file():
            edit.append(t)

    if aggressive:
        edit = edit[: max(4, max_files // 2)]
    else:
        edit = edit[:max_files]

    read_files = find_instruction_files(root)
    read_files = [r for r in read_files if r not in edit][:6]

    mt = map_tokens_for_repo(file_count, aggressive)
    meta = {
        "tracked_non_excluded": file_count,
        "task_paths": task_paths[:20],
        "aggressive": aggressive,
        "edit_count": len(edit),
        "read_count": len(read_files),
    }
    return mt, edit, read_files, meta


def main(argv: List[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--self-test":
        return _self_test()
    root = Path(argv[1] if len(argv) > 1 else ".")
    prompt = os.environ.get("TASK_PROMPT", "")
    if len(argv) > 2:
        prompt = argv[2]
    aggressive = os.environ.get("PAI_CONTEXT_AGGRESSIVE", "") == "1"
    mt, edit, read, meta = select(root, prompt, aggressive=aggressive)
    print(f"MAP_TOKENS={mt}")
    for p in edit:
        print(f"FILE={p}")
    for p in read:
        print(f"READ={p}")
    print(
        f"META=tracked={meta['tracked_non_excluded']} edit={meta['edit_count']} "
        f"read={meta['read_count']} aggressive={meta['aggressive']}"
    )
    return 0


def _self_test() -> int:
    import tempfile
    import subprocess

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "src").mkdir()
        (root / "src" / "app.js").write_text("export const x = 1\n")
        (root / "src" / "util.js").write_text("export const y = 2\n")
        (root / "test").mkdir()
        (root / "test" / "app.test.js").write_text("test('x', () => {})\n")
        (root / "CONTRIBUTING.md").write_text("# contribute\n")
        (root / "node_modules" / "pkg").mkdir(parents=True)
        (root / "node_modules" / "pkg" / "index.js").write_text("module.exports=1\n")
        (root / "dist").mkdir(exist_ok=True)
        (root / "dist" / "bundle.js").write_text("bundle\n")
        bulk = root / "bulk"
        bulk.mkdir()
        for i in range(500):
            (bulk / f"f{i}.txt").write_text("x\n")

        subprocess.run(["git", "init"], cwd=td, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=td, capture_output=True)

        prompt = (
            "Update src/app.js to export z. Follow CONTRIBUTING.md. "
            "Add coverage in test/app.test.js. Create docs/personal-ai-bot-e2e-proof.md."
        )
        mt, edit, read, meta = select(root, prompt, aggressive=False)
        assert mt <= 128, mt
        assert "src/app.js" in edit, edit
        assert all(not p.startswith("node_modules/") for p in edit)
        assert all(not p.startswith("dist/") for p in edit)
        assert meta["tracked_non_excluded"] >= 500

        mt2, edit2, _, meta2 = select(root, prompt, aggressive=True)
        assert mt2 == 0, mt2
        assert len(edit2) <= len(edit), (edit2, edit)
        assert meta2["aggressive"] is True

        assert map_tokens_for_repo(10, False) == 1024
        assert map_tokens_for_repo(200, False) == 256
        assert map_tokens_for_repo(500, False) == 128
        assert map_tokens_for_repo(500, True) == 0

        paths = extract_task_paths("Implement foo. Follow CONTRIBUTING.md carefully.")
        assert "CONTRIBUTING.md" not in paths, paths

        print("CONTEXT_SELECT_SELF_TEST=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
