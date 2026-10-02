#!/usr/bin/env bash
# PAI agent execution: must run on agent/<task-id> only.
# Selective context + bounded multi-provider fallback. Does not invent files.
set -euo pipefail
BRANCH="${AGENT_BRANCH:?}"
test "$(git branch --show-current)" = "$BRANCH" || { echo "STAGE=AGENT_EXECUTION failed expected=$BRANCH actual=$(git branch --show-current)"; exit 1; }

load_helper() {
  local name="$1" dest="$2"
  if [ -s "$dest" ]; then return 0; fi
  if [ -f ".github/scripts/$name" ]; then
    cp ".github/scripts/$name" "$dest"
  elif [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    REF="${GITHUB_SHA:-main}"
    gh api "repos/${GITHUB_REPOSITORY}/contents/.github/scripts/${name}?ref=${REF}" --jq .content \
      | base64 --decode > "$dest" || true
  fi
  test -s "$dest"
}

CONTEXT_SCRIPT="/tmp/pai-context-select.py"
PROVIDER_SCRIPT="/tmp/pai-provider-select.py"
load_helper pai-context-select.py "$CONTEXT_SCRIPT" || { echo "STAGE=AGENT_EXECUTION failed: missing pai-context-select.py"; exit 1; }
load_helper pai-provider-select.py "$PROVIDER_SCRIPT" || { echo "STAGE=AGENT_EXECUTION failed: missing pai-provider-select.py"; exit 1; }

if [ -z "${GEMINI_API_KEY:-}" ] && [ -n "${LLM_API_KEY:-}" ]; then
  export GEMINI_API_KEY="$LLM_API_KEY"
fi

PROVIDER_LINES=$(python3 "$PROVIDER_SCRIPT" 2>/tmp/provider_err.txt || true)
if [ -z "${PROVIDER_LINES:-}" ]; then
  echo "STAGE=AGENT_EXECUTION failed: no configured LLM providers"
  cat /tmp/provider_err.txt 2>/dev/null || true
  exit 1
fi
echo "provider_chain:"
printf '%s\n' "$PROVIDER_LINES" | sed 's/ KEY_ENV=[^ ]*//'

activate_provider() {
  local name="$1" model="$2" base="$3" key_env="$4"
  ACTIVE_PROVIDER="$name"
  MODEL="$model"
  if [ -n "$base" ]; then
    export OPENAI_API_BASE="$base"
    export OPENAI_API_KEY="${!key_env}"
  else
    unset OPENAI_API_BASE OPENAI_API_KEY || true
  fi
  echo "provider=$ACTIVE_PROVIDER model=$MODEL base=${OPENAI_API_BASE:-native} branch=$(git branch --show-current) HEAD=$(git rev-parse HEAD) baseline=$BASELINE_SHA"
}

select_context() {
  local aggressive_flag="${1:-0}"
  if [ "$aggressive_flag" = "1" ]; then
    PAI_CONTEXT_AGGRESSIVE=1 python3 "$CONTEXT_SCRIPT" . "$TASK_PROMPT"
  else
    PAI_CONTEXT_AGGRESSIVE=0 python3 "$CONTEXT_SCRIPT" . "$TASK_PROMPT"
  fi
}

build_aider_args_from_selection() {
  EXTRA_ARGS=()
  MAP_TOKENS=1024
  FILE_HINTS=""
  SELECTED_FILE_COUNT=0
  SELECTED_READ_COUNT=0
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      MAP_TOKENS=*) MAP_TOKENS="${line#MAP_TOKENS=}" ;;
      FILE=*)
        f="${line#FILE=}"
        if [ -e "$f" ]; then
          EXTRA_ARGS+=(--file "$f")
          FILE_HINTS="${FILE_HINTS} ${f}"
          SELECTED_FILE_COUNT=$((SELECTED_FILE_COUNT + 1))
        fi
        ;;
      READ=*)
        f="${line#READ=}"
        if [ -e "$f" ]; then
          EXTRA_ARGS+=(--read "$f")
          SELECTED_READ_COUNT=$((SELECTED_READ_COUNT + 1))
        fi
        ;;
      META=*) echo "context_$line" ;;
    esac
  done
  FILE_HINTS="${FILE_HINTS# }"
  EXTRA_ARGS+=(--map-tokens "$MAP_TOKENS")
  EXTRA_ARGS+=(--no-show-model-warnings)
  echo "map_tokens=$MAP_TOKENS selected_file_count=$SELECTED_FILE_COUNT selected_read_count=$SELECTED_READ_COUNT file_hints=$FILE_HINTS"
}

SELECTION=$(select_context 0)
printf '%s\n' "$SELECTION"
build_aider_args_from_selection <<< "$SELECTION"

AGENT_INSTRUCTION=$(printf '%s\n\n---\nWorker constraints (mandatory):\n1. You are on branch %s. Do not checkout main/master/default.\n2. IMPLEMENT the requested changes with actual file edits. Do not only inspect, plan, or describe.\n3. If the task names specific files or paths to create/modify, those paths must be modified (or created when the task asks to create them).\n4. Prefer reading CONTRIBUTING.md / README / AGENTS.md / existing tests when present, then implement — do not edit guidance files unless the task explicitly asks to change them.\n5. Do not change unrelated config such as .gitignore unless the task explicitly requires it.\n6. Do not stop after exploration tool calls — finish by writing the code/docs the task requests.\n7. Do not invent task IDs, commit SHAs, or test results. The worker will write authoritative runtime proof metadata after acceptance.\n8. Only open/edit files needed for this task; do not load the entire repository into context.\n' "$TASK_PROMPT" "$BRANCH")

classify_failure() {
  python3 "$PROVIDER_SCRIPT" --classify "$1"
}

run_aider() {
  set +e
  AIDER_OUTPUT=$(printf '%s' "$1" | aider --yes --no-auto-commits --model "$MODEL" "${EXTRA_ARGS[@]}" --message-file /dev/stdin 2>&1)
  AIDER_RC=$?
  set -e
  printf '%s\n' "$AIDER_OUTPUT"
  test "$(git branch --show-current)" = "$BRANCH" || { echo "branch drift"; return 1; }
  local cat
  cat=$(classify_failure "$AIDER_OUTPUT")
  echo "failure_category=$cat aider_rc=$AIDER_RC provider=$ACTIVE_PROVIDER"
  case "$cat" in
    context) return 99 ;;
    quota) return 98 ;;
    auth) return 97 ;;
  esac
  return "$AIDER_RC"
}

has_diff() {
  ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard)" ]
}

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
FALLBACK_ATTEMPT=0
PROVIDER_ATTEMPTED=""
AGENT_OK=0

while IFS= read -r pline; do
  [ -n "$pline" ] || continue
  pname=$(printf '%s' "$pline" | sed -n 's/^PROVIDER=\([^ ]*\).*/\1/p')
  pmodel=$(printf '%s' "$pline" | sed -n 's/.* MODEL=\([^ ]*\).*/\1/p')
  pbase=$(printf '%s' "$pline" | sed -n 's/.* BASE=\([^ ]*\).*/\1/p')
  pkey=$(printf '%s' "$pline" | sed -n 's/.* KEY_ENV=\([^ ]*\).*/\1/p')
  [ -n "$pname" ] || continue
  FALLBACK_ATTEMPT=$((FALLBACK_ATTEMPT + 1))
  PROVIDER_ATTEMPTED="${PROVIDER_ATTEMPTED} ${pname}"
  echo "fallback_attempt=$FALLBACK_ATTEMPT provider=$pname"
  activate_provider "$pname" "$pmodel" "$pbase" "$pkey"

  SELECTION=$(select_context 0)
  build_aider_args_from_selection <<< "$SELECTION"

  set +e
  run_aider "$AGENT_INSTRUCTION"
  RC=$?
  set -e

  if [ "$RC" = "99" ]; then
    echo "Retry with reduced context after token/context limit provider=$ACTIVE_PROVIDER"
    SELECTION=$(select_context 1)
    printf '%s\n' "$SELECTION"
    build_aider_args_from_selection <<< "$SELECTION"
    set +e
    run_aider "$(printf '%s\n\nIMPORTANT: Context was reduced due to token limits. Edit only the files provided. Implement the task now.' "$AGENT_INSTRUCTION")"
    RC=$?
    set -e
  fi

  if [ "$RC" = "98" ] || [ "$RC" = "97" ]; then
    echo "provider_switch reason=$( [ "$RC" = "98" ] && echo quota || echo auth ) from=$ACTIVE_PROVIDER"
    continue
  fi

  if has_diff; then
    AGENT_OK=1
    break
  fi

  echo "Retry after empty edit provider=$ACTIVE_PROVIDER"
  set +e
  run_aider "$(printf '%s\n\nIMPORTANT: Apply the file change now. Write the actual file contents. Do not only plan.' "$AGENT_INSTRUCTION")"
  RC=$?
  set -e
  if has_diff; then
    AGENT_OK=1
    break
  fi
  echo "provider_exhausted=$ACTIVE_PROVIDER no_diff=1"
done <<< "$PROVIDER_LINES"

if [ "$AGENT_OK" -ne 1 ] || ! has_diff; then
  echo "STAGE=AGENT_EXECUTION failed: no repository changes produced"
  echo "providers_attempted=${PROVIDER_ATTEMPTED# }"
  exit 1
fi

if has_diff && ! hint_paths_touched; then
  echo "Partial edit detected (hint paths still untouched); forcing implementation pass"
  run_aider "$(printf '%s\n\nIMPORTANT: Previous edits did not cover the required implementation paths (%s). Edit those files now with the requested behavior. Do not only add docs or .gitignore.' "$AGENT_INSTRUCTION" "$FILE_HINTS")" || true
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
      printf '%s' "$RETRY_MSG" | aider --yes --no-auto-commits --model "$MODEL" --map-tokens 0 --no-show-model-warnings "${RETRY_FILES[@]}" --message-file /dev/stdin 2>&1 || true
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
VERIFY_NOTE="skipped (no package.json build)"
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
      VERIFY_NOTE="$RUN_CMD run build rc=$rc"
    elif [ "$rc" -eq 0 ]; then
      echo "VERIFY: build skipped (no node_modules or no build script)"
      VERIFY_NOTE="build skipped"
    else
      VERIFY_NOTE="install/build failed rc=$rc"
    fi
  else rc=0; VERIFY_NOTE="no package.json"; fi
  set -e
  [ "$rc" -eq 0 ] && verified=1 && break
  tail -n 40 "$LOG" || true
  [ "$attempt" -lt 3 ] && run_aider "Verification failed. Stay on $BRANCH." || true
done
test "$verified" -eq 1 || { echo "STAGE=VERIFICATION failed"; exit 1; }

rm -rf node_modules .next dist build .aider* 2>/dev/null || true
if git show "$BASELINE_SHA:package-lock.json" >/dev/null 2>&1; then :; else rm -f package-lock.json 2>/dev/null || true; fi

if ! printf '%s' "$TASK_PROMPT" | grep -qiE '\.gitignore'; then
  if git diff --name-only "$BASELINE_SHA" | grep -qx '.gitignore' \
    || git ls-files --others --exclude-standard | grep -qx '.gitignore'; then
    echo "Discarding unsolicited .gitignore change"
    git checkout "$BASELINE_SHA" -- .gitignore 2>/dev/null || rm -f .gitignore 2>/dev/null || true
  fi
fi

PROOF_PATH="docs/personal-ai-bot-e2e-proof.md"
need_proof=0
if printf '%s' "$TASK_PROMPT" | grep -q 'personal-ai-bot-e2e-proof'; then need_proof=1; fi
if [ -f "$PROOF_PATH" ]; then need_proof=1; fi
if [ "$need_proof" -eq 1 ]; then
  mkdir -p docs
  cat > "$PROOF_PATH" <<PROOF_EOF
# Personal AI Bot E2E proof (worker-authored)

PERSONAL_AI_BOT_E2E_PROOF=PASS
task_id=${TASK_ID}
upstream_repo=${UPSTREAM_REPO:-}
writable_repo=${WRITABLE_REPO:-}
agent_branch=${BRANCH}
target_base_branch=${BASE_BRANCH:-}
baseline_sha=${BASELINE_SHA}
final_commit_sha=PENDING_COMMIT
acceptance=PASS
verification=PASS
verification_note=${VERIFY_NOTE}
active_provider=${ACTIVE_PROVIDER:-}
providers_attempted=${PROVIDER_ATTEMPTED# }
worker_note=Runtime metadata written by PAI worker after acceptance and verification. Not model-invented.
PROOF_EOF
fi

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

if [ "$need_proof" -eq 1 ] && [ -f "$PROOF_PATH" ]; then
  sed -i "s/^final_commit_sha=.*/final_commit_sha=${COMMIT_SHA}/" "$PROOF_PATH"
  git add "$PROOF_PATH"
  if ! git diff --cached --quiet; then
    git commit -m "agent(${TASK_ID}): worker e2e proof metadata"
    COMMIT_SHA=$(git rev-parse HEAD)
  fi
fi

test "$(git branch --show-current)" = "$BRANCH"
echo "STAGE=PUSH branch=$BRANCH commit=$COMMIT_SHA"
git push -u origin "refs/heads/${BRANCH}:refs/heads/${BRANCH}"
echo "has_changes=true" >> "$GITHUB_OUTPUT"
echo "branch=$BRANCH" >> "$GITHUB_OUTPUT"
echo "commit=$COMMIT_SHA" >> "$GITHUB_OUTPUT"
