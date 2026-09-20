#!/usr/bin/env python3
"""Task output acceptance gate.

Fails when the agent produced no meaningful work, or when paths the prompt
explicitly asked to create/modify/delete are missing, or when exact-content
requirements are not met.

Does NOT treat repository identifiers (owner/repo), URLs, or conceptual
slash phrases (e.g. page/route, API/data-access, verification/acceptance)
as required filesystem paths.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from typing import List, Optional, Sequence, Set, Tuple

HOUSEKEEPING_NAMES = {
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
}
HOUSEKEEPING_SUFFIXES = (
    ".lock",
    ".lockb",
    ".log",
    ".tsbuildinfo",
)
HOUSEKEEPING_PREFIXES = (
    ".aider",
    ".next/",
    "dist/",
    "build/",
    "coverage/",
    "node_modules/",
)

OWNER_REPO_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}/"
    r"[A-Za-z0-9._-]{1,100}$"
)

CONTEXTUAL_SEGMENT_BLOCKLIST = {
    "verification",
    "acceptance",
    "process",
    "pipeline",
    "workflow",
    "repository",
    "github",
    "branch",
    "commit",
    "pull",
    "request",
    "status",
    "callback",
    "deploy",
    "deployment",
    "production",
    "staging",
    "page",
    "route",
    "api",
    "ui",
    "data",
    "access",
    "control",
    "plane",
    "worker",
    "run",
    "task",
    "application",
    "feature",
    "logic",
    "service",
    "backend",
    "frontend",
}


# Common technology/framework names that contain a dot but are not filesystem paths.
# These must never become required paths unless the prompt explicitly identifies them
# as a filename/path (for example, by using a path root, quotes, or "file named").
TECHNOLOGY_DOTTED_NAMES = {
    "next.js",
    "nuxt.js",
    "vue.js",
    "node.js",
    "react.js",
    "express.js",
    "nest.js",
    "angular.js",
    "three.js",
    "d3.js",
    "socket.io",
}

KNOWN_SOURCE_ROOTS = (
    "src/",
    "app/",
    "lib/",
    "tests/",
    "test/",
    "__tests__/",
    "pages/",
    "components/",
    "scripts/",
    "packages/",
    ".github/",
)

IMPLEMENTATION_VERBS = re.compile(
    r"\b(add|create|implement|build|fix|update|refactor|remove|delete|replace|"
    r"integrate|wire|support|enable|introduce|modify|change|make|write)\b",
    re.I,
)
EXPLICIT_CODE_INTENT = re.compile(
    r"\b(api|route|endpoint|component|page|database|schema|table|function|class|"
    r"workflow|worker|dashboard|queue|test|feature|logic|backend|frontend|ui|"
    r"service|auth|callback|deploy|deployment|file)\b",
    re.I,
)

# Path tokens with file extensions (supports [id] segments).
PATH_WITH_EXT_RE = re.compile(
    r"(?:`([^`\n]+\.[A-Za-z0-9_.-]+)`|\"([^\"\n]+\.[A-Za-z0-9_.-]+)\"|"
    r"'([^'\n]+\.[A-Za-z0-9_.-]+)'|"
    r"((?:[A-Za-z0-9_.\[\]-]+/)+[A-Za-z0-9_.\[\]-]+\.[A-Za-z0-9_.-]+)|"
    r"([A-Za-z0-9_.\[\]-]+\.[A-Za-z0-9_.-]{1,15}))"
)

NAMED_FILE_RE = re.compile(
    r"\b(?:file\s+named|named|file)\s+[`\"']?"
    r"(?P<name>(?:[A-Za-z0-9_.\[\]-]+/)*[A-Za-z0-9_.\[\]-]+\.[A-Za-z0-9_.-]+)"
    r"[`\"']?",
    re.I,
)

EXACT_CONTENT_RE = re.compile(
    r"(?:containing|with)\s+exactly(?:\s+the\s+(?:single\s+)?line)?\s*:?\s*"
    r"(?:[`\"'](?P<q>.+?)[`\"']|(?P<plain>.+?))"
    r"(?:\n|$)",
    re.I | re.S,
)


def run_git(*args: str) -> str:
    return subprocess.run(
        args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False
    ).stdout


def is_housekeeping(path: str) -> bool:
    lower = path.lower().replace("\\", "/")
    base = lower.rsplit("/", 1)[-1]
    if base in HOUSEKEEPING_NAMES or lower in HOUSEKEEPING_NAMES:
        return True
    if any(lower.endswith(s) for s in HOUSEKEEPING_SUFFIXES):
        return True
    if any(lower.startswith(p) or f"/{p}" in f"/{lower}" for p in HOUSEKEEPING_PREFIXES):
        return True
    return False


def is_owner_repo(token: str) -> bool:
    t = token.strip().strip("/").strip("`\"'")
    if not t or t.count("/") != 1:
        return False
    if re.search(r"\.[A-Za-z0-9]{1,10}$", t.split("/", 1)[1]):
        return False
    return bool(OWNER_REPO_RE.match(t))


def has_file_extension(token: str) -> bool:
    base = token.rstrip("/").rsplit("/", 1)[-1]
    return bool(re.search(r"\.[A-Za-z0-9]{1,15}$", base))


def is_conceptual_slash_phrase(token: str) -> bool:
    t = token.strip().strip("/").strip("`\"'").lower()
    if not t or "/" not in t:
        return False
    if has_file_extension(t):
        return False
    if any(t.startswith(root) for root in KNOWN_SOURCE_ROOTS):
        return False
    segments = [s for s in t.split("/") if s]
    if not segments:
        return True
    if all(s in CONTEXTUAL_SEGMENT_BLOCKLIST for s in segments):
        return True
    if len(segments) <= 4 and all(
        re.fullmatch(r"[a-z][a-z0-9-]{0,24}", s) for s in segments
    ):
        return True
    return False


def looks_like_url(token: str) -> bool:
    t = token.strip().lower()
    return t.startswith(("http://", "https://", "git@", "ssh://"))


def normalize_path(token: str) -> str:
    t = token.strip().strip("`\"'").strip()
    t = t.strip(".",).strip()
    t = re.sub(r"[,:;]+$", "", t)
    return t.replace("\\", "/")


def is_plausible_filesystem_path(path: str) -> bool:
    if not path:
        return False
    if looks_like_url(path) or is_owner_repo(path) or is_conceptual_slash_phrase(path):
        return False
    lower = path.lower().strip("/")
    # A bare dotted technology name such as "Next.js" is prose, not a path.
    # Real dotted files (README.md, package.json, app.tsx, etc.) remain valid.
    if "/" not in lower and lower in TECHNOLOGY_DOTTED_NAMES:
        return False
    if has_file_extension(path):
        return True
    return any(lower.startswith(root) for root in KNOWN_SOURCE_ROOTS)


def extract_explicit_required_paths(prompt: str) -> Set[str]:
    required: Set[str] = set()

    # Only consider paths when an implementation verb is present.
    if not IMPLEMENTATION_VERBS.search(prompt):
        return required

    # Split into sentence-ish windows around verbs and collect path-with-ext tokens.
    for verb_match in IMPLEMENTATION_VERBS.finditer(prompt):
        start = verb_match.start()
        window = prompt[start : start + 240]
        for m in PATH_WITH_EXT_RE.finditer(window):
            groups = [g for g in m.groups() if g]
            for g in groups:
                path = normalize_path(g)
                if is_plausible_filesystem_path(path):
                    required.add(path)

    for m in NAMED_FILE_RE.finditer(prompt):
        path = normalize_path(m.group("name") or "")
        if path and is_plausible_filesystem_path(path):
            required.add(path)

    return required


def extract_exact_content_requirement(prompt: str) -> Optional[Tuple[Optional[str], str]]:
    named = None
    nm = NAMED_FILE_RE.search(prompt)
    if nm:
        named = normalize_path(nm.group("name") or "")

    m = EXACT_CONTENT_RE.search(prompt)
    if not m:
        return None
    content = (m.group("q") or m.group("plain") or "").strip()
    if not content:
        return None
    return named, content


def classify_changes(changed: Sequence[str]) -> Tuple[List[str], List[str]]:
    implementation: List[str] = []
    housekeeping: List[str] = []
    for p in changed:
        if is_housekeeping(p):
            housekeeping.append(p)
        else:
            implementation.append(p)
    return implementation, housekeeping


def path_satisfied(expected: str, changed: Sequence[str]) -> bool:
    if expected in changed:
        return True
    if expected.endswith("/"):
        return any(p.startswith(expected) for p in changed)
    return any(p.startswith(expected + "/") for p in changed)


def read_file_content(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def evaluate(
    prompt: str,
    changed: Sequence[str],
    *,
    file_contents: Optional[dict] = None,
    cwd: Optional[str] = None,
) -> Tuple[bool, List[str], dict]:
    changed_list = sorted({p.replace("\\", "/") for p in changed if p})
    implementation, housekeeping = classify_changes(changed_list)
    required_paths = extract_explicit_required_paths(prompt)

    missing = sorted(p for p in required_paths if not path_satisfied(p, changed_list))

    reasons: List[str] = []
    if not changed_list:
        reasons.append("No repository changes were produced.")

    if missing:
        reasons.append(
            "Explicit requested path(s) were not changed: " + ", ".join(missing[:8])
        )

    has_impl_verb = bool(IMPLEMENTATION_VERBS.search(prompt))
    has_code_intent = bool(EXPLICIT_CODE_INTENT.search(prompt))
    doc_only = bool(changed_list) and all(
        p.lower().endswith((".md", ".mdx", ".txt", ".rst"))
        or p.lower().startswith(("docs/", "documentation/"))
        for p in changed_list
    )

    if has_impl_verb and has_code_intent and changed_list and not implementation and not doc_only:
        reasons.append(
            "The task requests implementation work, but only housekeeping/generated files changed."
        )
    if has_impl_verb and has_code_intent and not changed_list:
        reasons.append(
            "The task requests implementation work but the working tree is unchanged."
        )

    exact = extract_exact_content_requirement(prompt)
    if exact is not None:
        fname, expected = exact
        candidates: List[str] = [fname] if fname else (list(implementation) or list(changed_list))
        content_ok = False
        checked = []
        for c in candidates:
            raw = None
            if file_contents is not None and c in file_contents:
                raw = file_contents[c]
            else:
                path = c if cwd is None else os.path.join(cwd, c)
                raw = read_file_content(path)
            if raw is None:
                continue
            checked.append(c)
            got = raw.rstrip("\n")
            exp = expected.rstrip("\n")
            if got == exp or raw == expected or raw.strip() == expected.strip():
                content_ok = True
                break
        if not content_ok:
            target = fname or (",".join(checked[:3]) if checked else "(no candidate file)")
            reasons.append(f"Exact content requirement not met for {target}.")

    diagnostics = {
        "changed": changed_list,
        "implementation": implementation,
        "housekeeping": housekeeping,
        "required_paths": sorted(required_paths),
        "missing": missing,
    }
    return (len(reasons) == 0), reasons, diagnostics


def collect_git_changes(baseline: str) -> List[str]:
    status = run_git("git", "status", "--porcelain").splitlines()
    tracked = run_git("git", "diff", "--name-only", baseline).splitlines()
    untracked = [line[3:] for line in status if line.startswith("?? ")]
    return sorted({p for p in tracked + untracked if p})



def _self_test() -> None:
    """Regression checks for prose terms being mistaken for filesystem paths."""
    passed, _, diag = evaluate(
        "Add a short Architecture overview to README.md describing the Next.js/Vercel control plane and Neon.",
        ["README.md"],
    )
    assert passed, diag
    assert diag["required_paths"] == ["README.md"], diag


def main(argv: Sequence[str]) -> int:
    if len(argv) == 2 and argv[1] == "--self-test":
        _self_test()
        print("ACCEPTANCE_SELF_TEST=PASS")
        return 0
    if len(argv) < 3:
        print("Usage: task-acceptance-gate.py <prompt> <baseline_sha>", file=sys.stderr)
        return 2
    prompt = argv[1]
    baseline = argv[2]
    changed = collect_git_changes(baseline)
    passed, reasons, diag = evaluate(prompt, changed, cwd=os.getcwd())

    print("ACCEPTANCE_CHANGED_FILES=" + ",".join(diag["changed"]))
    print("ACCEPTANCE_IMPLEMENTATION_FILES=" + ",".join(diag["implementation"]))
    print("ACCEPTANCE_REQUIRED_PATHS=" + ",".join(diag["required_paths"]))
    print("ACCEPTANCE_MISSING_PATHS=" + ",".join(diag["missing"]))

    if not passed:
        print("ACCEPTANCE_GATE=FAIL")
        for reason in reasons:
            print("ACCEPTANCE_REASON=" + reason)
        return 2

    print("ACCEPTANCE_GATE=PASS")
    print(
        "Acceptance evidence: "
        + str(len(diag["changed"]))
        + " changed file(s); "
        + str(len(diag["implementation"]))
        + " implementation/documentation artifact(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
