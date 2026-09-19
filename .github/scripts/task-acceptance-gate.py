#!/usr/bin/env python3
import re, subprocess, sys

prompt = sys.argv[1]
baseline = sys.argv[2]

def run(*args):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

status = run("git", "status", "--porcelain").stdout.splitlines()
tracked = run("git", "diff", "--name-only", baseline).stdout.splitlines()
untracked = [line[3:] for line in status if line.startswith("?? ")]
changed = sorted(set(p for p in tracked + untracked if p))

implementation = []
for p in changed:
    lower = p.lower()
    if (
        lower == ".gitignore"
        or lower.endswith((".lock", ".lockb", ".log", ".tsbuildinfo"))
        or lower.startswith(".aider")
        or lower.startswith(".next/")
        or lower.startswith("dist/")
        or lower.startswith("build/")
        or lower.startswith("coverage/")
    ):
        continue
    implementation.append(p)

path_candidates = set()
for m in re.findall(r"(?<![A-Za-z0-9])(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?", prompt):
    m = m.strip(".,:;'\"()[]{}")
    if "/" in m and not m.startswith(("http://", "https://")):
        path_candidates.add(m)

missing = []
for expected in sorted(path_candidates):
    if expected in changed or (expected.endswith("/") and any(p.startswith(expected) for p in changed)):
        continue
    if any(p.startswith(expected + "/") for p in changed):
        continue
    if expected.count("/") >= 1 and not re.fullmatch(r"(owner|repo|user|branch)/.*", expected):
        missing.append(expected)

doc_only = bool(changed) and all(
    p.lower().endswith((".md", ".mdx", ".txt", ".rst"))
    or p.lower().startswith(("docs/", "documentation/"))
    for p in changed
)

implementation_verbs = re.search(
    r"\b(add|create|implement|build|fix|update|refactor|remove|replace|integrate|wire|support|enable|introduce|modify|change|make)\b",
    prompt, re.I
)
explicit_code_intent = re.search(
    r"\b(api|route|endpoint|component|page|database|schema|table|function|class|workflow|worker|dashboard|queue|test|feature|logic|backend|frontend|ui|service|auth|callback|deploy|deployment)\b",
    prompt, re.I
)

reasons = []
if not changed:
    reasons.append("No repository changes were produced.")
if missing:
    reasons.append("Explicit requested path(s) were not changed: " + ", ".join(missing[:8]))
if implementation_verbs and explicit_code_intent and changed and not implementation and not doc_only:
    reasons.append("The task requests implementation work, but only housekeeping/generated files changed.")
if implementation_verbs and explicit_code_intent and not changed:
    reasons.append("The task requests implementation work but the working tree is unchanged.")

print("ACCEPTANCE_CHANGED_FILES=" + ",".join(changed))
print("ACCEPTANCE_IMPLEMENTATION_FILES=" + ",".join(implementation))
print("ACCEPTANCE_MISSING_PATHS=" + ",".join(missing))
if reasons:
    print("ACCEPTANCE_GATE=FAIL")
    for reason in reasons:
        print("ACCEPTANCE_REASON=" + reason)
    sys.exit(2)

print("ACCEPTANCE_GATE=PASS")
print("Acceptance evidence: " + str(len(changed)) + " changed file(s); " + str(len(implementation)) + " implementation/documentation artifact(s).")
