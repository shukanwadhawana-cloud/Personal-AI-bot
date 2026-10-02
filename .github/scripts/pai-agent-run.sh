#!/usr/bin/env bash
# PAI agent execution: must run on agent/<task-id> only.
# Does not invent implementation files — Aider must produce real edits.
set -euo pipefail
BRANCH="${AGENT_BRANCH:?}"
test "$(git branch --show-current)" = "$BRANCH" || { echo "STAGE=AGENT_EXECUTION failed expected=$BRANCH actual=$(git branch --show-current)"; exit 1; }

PROVIDER="${LLM_PROVIDER:-auto}"
MODEL=""
export OPENAI_API_BASE="" OPENAI_API_KEY=""
if [ "$PROVIDER" = "openrouter" ] || { [ "$PROVIDER" = "auto" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; }; then
  test -n "${OPENROUTER_API_KEY:-}"; export OPENAI_API_BASE="https://openrouter.ai/api/v1"; export OPENAI_API_KEY="$OPENROUTER_API_KEY"
  MODEL="openai/${OPENROUTER_MODEL:-openrouter/free}"; ACTIVE_PROVIDER="openrouter"
elif [ "$PROVIDER" = "deepseek" ] || { [ "$PROVIDER" = "auto" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; }; then
  test -n "${DEEPSEEK_API_KEY:-}"; export OPENAI_API_BASE="https://api.deepseek.com"; export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
  MODEL="openai/${DEEPSEEK_MODEL:-deepseek-flash}"; ACTIVE_PROVIDER="deepseek"
elif [ "$PROVIDER" = "gemini" ] || [ "$PROVIDER" = "auto" ]; then
  test -n "${GEMINI_API_KEY:-}"; unset OPENAI_API_BASE OPENAI_API_KEY
  MODEL="gemini/gemini-3.6-flash"; ACTIVE_PROVIDER="gemini"
else echo "STAGE=AGENT_EXECUTION failed provider"; exit 1; fi
echo "provider=$ACTIVE_PROVIDER model=$MODEL branch=$(git branch --show-current) HEAD=$(git rev-parse HEAD) baseline=$BASELINE_SHA"

# Extract path-like tokens from the task for --file hints (Aider chat context).
FILE_HINTS=$(python3 -c '
import re, os
p = os.environ.get("TASK_PROMPT", "")
paths = re.findall(r"[\w./-]+\.[a-zA-Z0-9]{1,12}", p)
seen=set(); out=[]
for x in paths:
  if x in seen: continue
  if x.startswith("http") or "github.com" in x: continue
  if "/" in x or x.endswith((".md",".txt",".ts",".tsx",".js",".jsx",".mjs",".cjs",".py",".json",".yml",".yaml",".css",".html")):
    seen.add(x); out.append(x)
print(" ".join(out[:12]))
')
EXTRA_ARGS=()
for f in $FILE_HINTS; do
  # Only pass --file for paths that already exist; Aider still creates new files via edits.
  if [ -e "$f" ]; then EXTRA_ARGS+=(--file "$f"); fi
done
echo "file_hints=$FILE_HINTS"

# Strong instruction: implement, do not merely plan. Does not invent content for the worker.
AGENT_INSTRUCTION=$(printf '%s\n\n---\nWorker constraints (mandatory):\n1. You are on branch %s. Do not checkout main/master/default.\n2. IMPLEMENT the requested changes with actual file edits. Do not only inspect, plan, or describe.\n3. If the task names specific files or paths, those paths must be modified (or created when the task asks to create them).\n4. Prefer reading CONTRIBUTING.md / README / existing tests when present, then implement.\n5. Do not change unrelated config such as .gitignore unless the task explicitly requires it.\n6. Do not stop after exploration tool calls — finish by writing the code/docs the task requests.\n' "$TASK_PROMPT" "$BRANCH")

run_aider() {
  set +e
  if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
    AIDER_OUTPUT=$(printf '%s' "$1" | aider --yes --no-auto-commits --model "$MODEL" "${EXTRA_ARGS[@]}" --message-file /dev/stdin 2>&1)
  else
    AIDER_OUTPUT=$(printf '%s' "$1" | aider --yes --no-auto-commits --model "$MODEL" --message-file /dev/stdin 2>&1)
  fi
  AIDER_RC=$?; set -e
  printf '%s\n' "$AIDER_OUTPUT"
  test "$(git branch --show-current)" = "$BRANCH" || { echo "branch drift"; return 1; }
  return "$AIDER_RC"
}

has_diff() {
  ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard)" ]
}

# True when every existing path in FILE_HINTS appears in the current change set.
# Missing brand-new paths are left to the acceptance gate (authoritative).
hint_paths_touched() {
  [ -z "${FILE_HINTS// }" ] && return 0
  local changed
  changed=$(git diff --name-only "$BASELINE_SHA" 2>/dev/null; git ls-files --others --exclude-standard)
  local f
  for f in $FILE_HINTS; do
    [ -e "$f" ] || continue
    echo "$changed" | grep -Fxq "$f" || return 1
  done
  return 0
}

echo "STAGE=AGENT_EXECUTION"
run_aider "$AGENT_INSTRUCTION" || true
if ! has_diff; then
  echo "Retry after empty edit"
  run_aider "$(printf '%s\n\nIMPORTANT: Apply the file change now. Write the actual file contents. Do not only plan.' "$AGENT_INSTRUCTION")" || true
fi
if has_diff && ! hint_paths_touched; then
  echo "Partial edit detected (hint paths still untouched); forcing implementation pass"
  run_aider "$(printf '%s\n\nIMPORTANT: Previous edits did not cover the required implementation paths (%s). Edit those files now with the requested behavior. Do not only add docs or .gitignore.' "$AGENT_INSTRUCTION" "$FILE_HINTS")" || true
fi
if ! has_diff && [ "$ACTIVE_PROVIDER" != "gemini" ] && [ -n "${GEMINI_API_KEY:-}" ]; then
  unset OPENAI_API_BASE OPENAI_API_KEY; MODEL="gemini/gemini-3.6-flash"; ACTIVE_PROVIDER="gemini"
  echo "Fallback $ACTIVE_PROVIDER"; run_aider "$AGENT_INSTRUCTION" || true
fi
if ! has_diff; then
  echo "STAGE=AGENT_EXECUTION failed: no repository changes produced"
  exit 1
fi

echo "STAGE=ACCEPTANCE_GATE"
acceptance_passed=0
for a in 1 2 3; do
  set +e; ACCEPTANCE_OUTPUT=$(python /tmp/task-acceptance-gate.py "$TASK_PROMPT" "$BASELINE_SHA" 2>&1); rc=$?; set -e
  echo "$ACCEPTANCE_OUTPUT"
  if [ "$rc" -eq 0 ]; then acceptance_passed=1; break; fi
  if [ "$a" -lt 3 ]; then
    MISSING=$(printf '%s\n' "$ACCEPTANCE_OUTPUT" | sed -n 's/^ACCEPTANCE_MISSING_PATHS=//p' | head -n1 | tr ',' ' ')
    RETRY_FILES=()
    for f in $MISSING; do
      f="${f#"${f%%[![:space:]]*}"}"; f="${f%"${f##*[![:space:]]}"}"
      [ -n "$f" ] || continue
      [ -e "$f" ] && RETRY_FILES+=(--file "$f")
    done
    RETRY_MSG=$(printf 'Acceptance failed. You must IMPLEMENT the missing required paths with real file edits.\nMissing paths: %s\nOriginal task:\n%s\nEvidence:\n%s\nStay on branch %s. Do not only plan. Do not only edit unrelated docs or .gitignore.' \
      "${MISSING:-unknown}" "$TASK_PROMPT" "$ACCEPTANCE_OUTPUT" "$BRANCH")
    set +e
    if [ ${#RETRY_FILES[@]} -gt 0 ]; then
      printf '%s' "$RETRY_MSG" | aider --yes --no-auto-commits --model "$MODEL" "${RETRY_FILES[@]}" --message-file /dev/stdin 2>&1 || true
    else
      run_aider "$RETRY_MSG" || true
    fi
    set -e
    test "$(git branch --show-current)" = "$BRANCH" || { echo "branch drift after acceptance retry"; exit 1; }
  fi
done
test "$acceptance_passed" -eq 1 || { echo "STAGE=ACCEPTANCE_GATE failed"; exit 1; }

echo "STAGE=VERIFICATION"
verified=0
for attempt in 1 2 3; do
  set +e; rc=0; LOG="/tmp/v$attempt.log"; : > "$LOG"
  if [ -f package.json ]; then
    INSTALL_CMD=""; RUN_CMD="npm"
    if [ -f pnpm-lock.yaml ]; then corepack enable >/dev/null 2>&1 || true; INSTALL_CMD="pnpm install --frozen-lockfile"; RUN_CMD="pnpm"
    elif [ -f yarn.lock ]; then corepack enable >/dev/null 2>&1 || true; INSTALL_CMD="yarn install --immutable"; RUN_CMD="yarn"
    elif [ -f bun.lockb ] || [ -f bun.lock ]; then INSTALL_CMD="bun install --frozen-lockfile"; RUN_CMD="bun"
    elif [ -f package-lock.json ]; then INSTALL_CMD="npm ci --no-audit --no-fund"; RUN_CMD="npm"
    else echo "VERIFY: no lockfile; skip install"; fi
    if [ -n "$INSTALL_CMD" ]; then eval "$INSTALL_CMD" >>"$LOG" 2>&1 || rc=$?; fi
    if [ "$rc" -eq 0 ] && [ -d node_modules ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:1)"; then
      eval "$RUN_CMD run build" >>"$LOG" 2>&1 || rc=$?
    elif [ "$rc" -eq 0 ]; then
      echo "VERIFY: build skipped (no node_modules or no build script)"
    fi
  else rc=0; fi
  set -e
  [ "$rc" -eq 0 ] && verified=1 && break
  tail -n 40 "$LOG" || true
  [ "$attempt" -lt 3 ] && run_aider "Verification failed. Stay on $BRANCH." || true
done
test "$verified" -eq 1 || { echo "STAGE=VERIFICATION failed"; exit 1; }

rm -rf node_modules .next dist build .aider* 2>/dev/null || true
if git show "$BASELINE_SHA:package-lock.json" >/dev/null 2>&1; then :; else rm -f package-lock.json 2>/dev/null || true; fi

echo "STAGE=COMMIT"
test "$(git branch --show-current)" = "$BRANCH"
git add -A
git reset HEAD -- node_modules .next dist build .aider* 2>/dev/null || true
if git diff --cached --quiet; then
  test "$(git rev-parse HEAD)" != "$BASELINE_SHA" || { echo "STAGE=COMMIT failed: no changes"; echo "has_changes=false" >> "$GITHUB_OUTPUT"; exit 1; }
else
  git commit -m "agent(${TASK_ID}): automated changes"
fi
COMMIT_SHA=$(git rev-parse HEAD)
test "$(git branch --show-current)" = "$BRANCH"
echo "STAGE=PUSH branch=$BRANCH commit=$COMMIT_SHA"
git push -u origin "refs/heads/${BRANCH}:refs/heads/${BRANCH}"
echo "has_changes=true" >> "$GITHUB_OUTPUT"
echo "branch=$BRANCH" >> "$GITHUB_OUTPUT"
echo "commit=$COMMIT_SHA" >> "$GITHUB_OUTPUT"
