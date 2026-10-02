#!/usr/bin/env bash
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

AGENT_INSTRUCTION=$(printf '%s\n\n---\nStay on branch %s. Do not checkout main/master/default.' "$TASK_PROMPT" "$BRANCH")

run_aider() {
  set +e
  AIDER_OUTPUT=$(printf '%s' "$1" | aider --yes --no-auto-commits --model "$MODEL" --message-file /dev/stdin 2>&1)
  AIDER_RC=$?; set -e
  printf '%s\n' "$AIDER_OUTPUT"
  test "$(git branch --show-current)" = "$BRANCH" || { echo "branch drift"; return 1; }
  return "$AIDER_RC"
}

echo "STAGE=AGENT_EXECUTION"
run_aider "$AGENT_INSTRUCTION" || {
  if printf '%s' "$AIDER_OUTPUT" | grep -Eqi '429|quota|rate.?limit|resource.?exhausted|503|high demand'; then
    if [ "$ACTIVE_PROVIDER" != "deepseek" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; then
      export OPENAI_API_BASE="https://api.deepseek.com"; export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
      MODEL="openai/${DEEPSEEK_MODEL:-deepseek-flash}"; ACTIVE_PROVIDER="deepseek"
    elif [ "$ACTIVE_PROVIDER" != "openrouter" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; then
      export OPENAI_API_BASE="https://openrouter.ai/api/v1"; export OPENAI_API_KEY="$OPENROUTER_API_KEY"
      MODEL="openai/${OPENROUTER_MODEL:-openrouter/free}"; ACTIVE_PROVIDER="openrouter"
    else exit 1; fi
    run_aider "$AGENT_INSTRUCTION" || exit 1
  else exit 1; fi
}

echo "STAGE=ACCEPTANCE_GATE"
acceptance_passed=0
for a in 1 2; do
  set +e; ACCEPTANCE_OUTPUT=$(python /tmp/task-acceptance-gate.py "$TASK_PROMPT" "$BASELINE_SHA" 2>&1); rc=$?; set -e
  echo "$ACCEPTANCE_OUTPUT"
  [ "$rc" -eq 0 ] && acceptance_passed=1 && break
  [ "$a" -lt 2 ] && run_aider "Acceptance failed. $TASK_PROMPT Evidence: $ACCEPTANCE_OUTPUT Stay on $BRANCH." || true
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
    else echo "VERIFY: no lockfile; skip install to avoid package-lock.json mutation"; fi
    if [ -n "$INSTALL_CMD" ]; then echo "VERIFY: $INSTALL_CMD"; eval "$INSTALL_CMD" >>"$LOG" 2>&1 || rc=$?; fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.lint?0:1)"; then
      if [ -f .eslintrc.json ] || [ -f .eslintrc.js ] || [ -f eslint.config.js ] || [ -f eslint.config.mjs ]; then
        eval "$RUN_CMD run lint" >>"$LOG" 2>&1 || rc=$?
      fi
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.typecheck?0:1)"; then
      eval "$RUN_CMD run typecheck" >>"$LOG" 2>&1 || rc=$?
    elif [ "$rc" -eq 0 ] && [ -f tsconfig.json ] && [ -d node_modules ]; then
      npx tsc --noEmit >>"$LOG" 2>&1 || rc=$?
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.test?0:1)"; then
      eval "$RUN_CMD test" >>"$LOG" 2>&1 || rc=$?
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:1)"; then
      if [ -d node_modules ] || [ -z "$INSTALL_CMD" ]; then
        eval "$RUN_CMD run build" >>"$LOG" 2>&1 || rc=$?
      else
        echo "VERIFY: build skipped (no node_modules; no lockfile install)"
      fi
    fi
  else rc=0; fi
  set -e
  [ "$rc" -eq 0 ] && verified=1 && break
  tail -n 40 "$LOG" || true
  [ "$attempt" -lt 3 ] && run_aider "Verification failed. $(tail -n 40 "$LOG" | head -c 4000). Stay on $BRANCH." || true
done
test "$verified" -eq 1 || { echo "STAGE=VERIFICATION failed"; exit 1; }

rm -rf node_modules .next dist build .aider* 2>/dev/null || true
if [ ! -f package-lock.json ] || git show "$BASELINE_SHA:package-lock.json" >/dev/null 2>&1; then :; else git checkout -- package-lock.json 2>/dev/null || rm -f package-lock.json; fi

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
