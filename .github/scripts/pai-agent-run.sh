#!/usr/bin/env bash
# PAI agent execution: must run on agent/<task-id> only.
set -euo pipefail

BRANCH="${AGENT_BRANCH:?}"
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BRANCH" ]; then
  echo "STAGE=AGENT_EXECUTION failed: expected=$BRANCH actual=$CURRENT"
  exit 1
fi

PROVIDER="${LLM_PROVIDER:-auto}"
MODEL=""
export OPENAI_API_BASE=""
export OPENAI_API_KEY=""
if [ "$PROVIDER" = "openrouter" ] || { [ "$PROVIDER" = "auto" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; }; then
  test -n "${OPENROUTER_API_KEY:-}"
  export OPENAI_API_BASE="https://openrouter.ai/api/v1"
  export OPENAI_API_KEY="$OPENROUTER_API_KEY"
  MODEL="openai/${OPENROUTER_MODEL:-openrouter/free}"
  ACTIVE_PROVIDER="openrouter"
elif [ "$PROVIDER" = "deepseek" ] || { [ "$PROVIDER" = "auto" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; }; then
  test -n "${DEEPSEEK_API_KEY:-}"
  export OPENAI_API_BASE="https://api.deepseek.com"
  export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
  MODEL="openai/${DEEPSEEK_MODEL:-deepseek-flash}"
  ACTIVE_PROVIDER="deepseek"
elif [ "$PROVIDER" = "gemini" ] || [ "$PROVIDER" = "auto" ]; then
  test -n "${GEMINI_API_KEY:-}"
  unset OPENAI_API_BASE OPENAI_API_KEY
  MODEL="gemini/gemini-3.6-flash"
  ACTIVE_PROVIDER="gemini"
else
  echo "STAGE=AGENT_EXECUTION failed: unsupported provider"; exit 1
fi
echo "Using provider $ACTIVE_PROVIDER model $MODEL"

echo "=== diagnostics ==="
echo "writable=$WRITABLE_REPO upstream=$UPSTREAM_REPO base=$BASE_BRANCH branch=$(git branch --show-current) HEAD=$(git rev-parse HEAD) baseline=$BASELINE_SHA"
ls -la | head -n 20
git status --short | head -n 20 || true
echo "=== end ==="

AGENT_INSTRUCTION=$(printf '%s\n\n---\nYou are on branch %s in %s (upstream %s, base %s). Do not switch to or commit on the default branch. Stay on %s.' \
  "$TASK_PROMPT" "$BRANCH" "$WRITABLE_REPO" "$UPSTREAM_REPO" "$BASE_BRANCH" "$BRANCH")

run_aider() {
  set +e
  AIDER_OUTPUT=$(printf '%s' "$1" | aider --yes --no-auto-commits --model "$MODEL" --message-file /dev/stdin 2>&1)
  AIDER_RC=$?
  set -e
  printf '%s\n' "$AIDER_OUTPUT"
  CUR=$(git branch --show-current)
  if [ "$CUR" != "$BRANCH" ]; then
    echo "STAGE=AGENT_EXECUTION failed: branch drift expected=$BRANCH actual=$CUR"
    return 1
  fi
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
    else
      echo "STAGE=AGENT_EXECUTION failed: quota"; exit 1
    fi
    echo "Fallback $ACTIVE_PROVIDER $MODEL"
    run_aider "$AGENT_INSTRUCTION" || exit 1
  else
    exit 1
  fi
}

echo "STAGE=ACCEPTANCE_GATE"
acceptance_passed=0
for acceptance_attempt in 1 2; do
  set +e
  ACCEPTANCE_OUTPUT=$(python /tmp/task-acceptance-gate.py "$TASK_PROMPT" "$BASELINE_SHA" 2>&1)
  acceptance_rc=$?
  set -e
  echo "$ACCEPTANCE_OUTPUT"
  if [ "$acceptance_rc" -eq 0 ]; then acceptance_passed=1; break; fi
  if [ "$acceptance_attempt" -lt 2 ]; then
    run_aider "Acceptance failed. Original: $TASK_PROMPT. Evidence: $ACCEPTANCE_OUTPUT. Stay on $BRANCH." || true
  fi
done
test "$acceptance_passed" -eq 1 || { echo "STAGE=ACCEPTANCE_GATE failed"; exit 1; }

echo "STAGE=VERIFICATION"
verified=0
for attempt in 1 2 3; do
  set +e
  rc=0
  VERIFY_LOG="/tmp/verify-$attempt.log"
  : > "$VERIFY_LOG"
  if [ -f package.json ]; then
    if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
      pnpm install --frozen-lockfile >>"$VERIFY_LOG" 2>&1 || pnpm install >>"$VERIFY_LOG" 2>&1 || rc=$?
    elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
      yarn install --frozen-lockfile >>"$VERIFY_LOG" 2>&1 || yarn install >>"$VERIFY_LOG" 2>&1 || rc=$?
    elif [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund >>"$VERIFY_LOG" 2>&1 || rc=$?
    else
      npm install --no-audit --no-fund >>"$VERIFY_LOG" 2>&1 || rc=$?
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.lint?0:1)"; then
      if [ -f .eslintrc.json ] || [ -f .eslintrc.js ] || [ -f eslint.config.js ] || [ -f eslint.config.mjs ]; then
        CI=true npm run lint >>"$VERIFY_LOG" 2>&1 || rc=$?
      fi
    fi
    if [ "$rc" -eq 0 ]; then
      if node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.typecheck?0:1)"; then
        npm run typecheck >>"$VERIFY_LOG" 2>&1 || rc=$?
      elif [ -f tsconfig.json ]; then
        npx tsc --noEmit >>"$VERIFY_LOG" 2>&1 || rc=$?
      fi
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.test?0:1)"; then
      npm test --if-present >>"$VERIFY_LOG" 2>&1 || rc=$?
    fi
    if [ "$rc" -eq 0 ] && node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:1)"; then
      npm run build >>"$VERIFY_LOG" 2>&1 || rc=$?
    fi
  elif [ -f Cargo.toml ]; then
    cargo check >>"$VERIFY_LOG" 2>&1 || rc=$?
  elif [ -f go.mod ]; then
    go test ./... >>"$VERIFY_LOG" 2>&1 || rc=$?
  else
    echo "no known package manager; skip" >>"$VERIFY_LOG"
    rc=0
  fi
  set -e
  if [ "$rc" -eq 0 ]; then verified=1; break; fi
  tail -n 80 "$VERIFY_LOG" || true
  if [ "$attempt" -lt 3 ]; then
    DIAG=$(tail -n 60 "$VERIFY_LOG" | head -c 8000)
    run_aider "Verification failed:\n$DIAG\nStay on $BRANCH." || true
  fi
done
test "$verified" -eq 1 || { echo "STAGE=VERIFICATION failed"; exit 1; }

rm -rf node_modules .next dist build .aider* 2>/dev/null || true

echo "STAGE=COMMIT"
test "$(git branch --show-current)" = "$BRANCH" || { echo "branch drift before commit"; exit 1; }
git add -A
git reset HEAD -- node_modules .next dist build .aider* 2>/dev/null || true
if git diff --cached --quiet; then
  if [ "$(git rev-parse HEAD)" = "$BASELINE_SHA" ]; then
    echo "STAGE=COMMIT failed: no changes"
    echo "has_changes=false" >> "$GITHUB_OUTPUT"
    exit 1
  fi
else
  git commit -m "agent(${TASK_ID}): automated changes"
fi
COMMIT_SHA=$(git rev-parse HEAD)
test "$(git branch --show-current)" = "$BRANCH"

echo "STAGE=PUSH"
git push -u origin "refs/heads/${BRANCH}:refs/heads/${BRANCH}"
echo "has_changes=true" >> "$GITHUB_OUTPUT"
echo "branch=$BRANCH" >> "$GITHUB_OUTPUT"
echo "commit=$COMMIT_SHA" >> "$GITHUB_OUTPUT"
echo "STAGE=PUSH ok $BRANCH $COMMIT_SHA"
