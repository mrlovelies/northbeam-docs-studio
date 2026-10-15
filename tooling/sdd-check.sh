#!/usr/bin/env bash
# sdd-check.sh — deterministic Spec-Driven Development gate.
# Reads git + filesystem ground truth; never trusts a model's self-report, so it
# holds through hallucination, assumption, and context compaction alike.
#
#   status            print phase, committed artifacts, violations, next step
#   gate-write <path> exit 0 = allow; exit 10 + reason on stdout = block
#   hook              PreToolUse hook: read tool JSON on stdin, emit allow/deny
#                     (gates Write/Edit/MultiEdit by path, and Bash by a coarse
#                      write-into-gated-path tripwire)
#   audit             pre-submit: assert the committed history shows
#                     spec -> plan -> tasks BEFORE implementation (guards no-squash)
#   --selftest        self-contained assertions in a throwaway repo
#
# The gate is code, not judgment. If the gate and anyone's belief disagree, the
# gate wins. Config: tooling/sdd.config.json.
set -uo pipefail

# ROOT from the script's own location (<ROOT>/tooling/sdd-check.sh), not cwd.
SELF="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
ROOT="$(dirname "$SELF")"
CFG="$ROOT/tooling/sdd.config.json"

FALLBACK_CODE_RE='\.(ts|tsx|js|jsx|mjs|cjs)$'   # used only when config is unreadable

config_ok() { [[ -f "$CFG" ]] && command -v jq >/dev/null 2>&1 && jq -e . "$CFG" >/dev/null 2>&1; }
cfgval() { jq -r "$1" "$CFG" 2>/dev/null; }

SPEC_ART="$(cfgval '.artifacts.spec')"
PLAN_ART="$(cfgval '.artifacts.plan')"
TASKS_ART="$(cfgval '.artifacts.tasks')"

committed() { [[ -n "$(git -C "$ROOT" log --format=%H -- "$1" 2>/dev/null | head -1)" ]]; }

# Lexically canonicalize a path (resolve ./ and seg/../). Portable (no bash4, no realpath).
normpath() {
  local p="$1" lead="" prev
  case "$p" in /*) lead="/"; p="${p#/}";; esac
  while :; do
    prev="$p"
    p="$(printf '%s' "$p" | sed -e 's#^\./##' -e 's#/\./#/#g')"
    p="$(printf '%s' "$p" | sed -e 's#^[^/]*/\.\./##' -e 's#/[^/]*/\.\./#/#')"
    [[ "$p" == "$prev" ]] && break
  done
  printf '%s%s' "$lead" "$p"
}

glob_match() { local path="$1" pat="${2//\*\*/\*}"; [[ "$path" == $pat ]]; }
matches_globs() { # $1 path, $2 jq-filter selecting a list of globs
  local p="$1" g
  while IFS= read -r g; do [[ -z "$g" ]] && continue; glob_match "$p" "$g" && return 0; done < <(jq -r "$2" "$CFG" 2>/dev/null)
  return 1
}
is_gated() { matches_globs "$1" '.implementationGlobs[]?' && ! matches_globs "$1" '.alwaysAllowGlobs[]?'; }
impl_allowed() { committed "$SPEC_ART" && committed "$PLAN_ART" && committed "$TASKS_ART"; }

phase() {
  if impl_allowed; then echo impl
  elif committed "$SPEC_ART" && committed "$PLAN_ART"; then echo plan
  elif committed "$SPEC_ART"; then echo spec
  else echo init; fi
}

rel_to_root() {
  local p="$1"; [[ "$p" = /* ]] || p="$(pwd)/$p"
  p="$(normpath "$p")"
  case "$p" in "$ROOT"/*) printf '%s' "${p#"$ROOT"/}";; "$ROOT") printf '.';; *) printf '%s' "$p";; esac
}

missing_artifacts() {
  local out=""
  committed "$SPEC_ART"  || out="spec.md"
  committed "$PLAN_ART"  || out="${out:+$out, }plan.md"
  committed "$TASKS_ART" || out="${out:+$out, }tasks.md"
  printf '%s' "$out"
}

# dir/file pathspecs derived from impl globs (strip at first *, drop extension-only globs)
impl_pathspecs() { cfgval '.implementationGlobs[]?' | sed -E 's/\*.*$//; s#/$##' | awk 'NF' | sort -u | tr '\n' ' '; }

violation() {
  local specs icommit tcommit
  specs="$(impl_pathspecs)"; [[ -z "$specs" ]] && return 0
  icommit="$(git -C "$ROOT" log --format=%H --reverse -- $specs 2>/dev/null | head -1)"
  [[ -z "$icommit" ]] && return 0
  if ! committed "$TASKS_ART"; then echo "VIOLATION: implementation committed but tasks.md is not (spec-first order broken)."; return 0; fi
  tcommit="$(git -C "$ROOT" log --diff-filter=A --format=%H --reverse -- "$TASKS_ART" 2>/dev/null | head -1)"
  if [[ -n "$tcommit" && "$icommit" != "$tcommit" ]] && git -C "$ROOT" merge-base --is-ancestor "$icommit" "$tcommit" 2>/dev/null; then
    echo "VIOLATION: implementation was committed before tasks.md (spec-first order broken)."
  fi
}

# coarse tripwire: does a Bash command look like it writes code into a gated path?
bash_writes_gated() {
  local c="$1"
  printf '%s' "$c" | grep -qE '((^|[[:space:]])>>?[[:space:]]*[A-Za-z0-9._/~-]|(^|[[:space:]])(tee|cp|mv|dd|install|patch)([[:space:]])|sed[[:space:]]+-i|git[[:space:]]+apply)' || return 1
  printf '%s' "$c" | grep -qE '(src/|app/|lib/|server/|db/|components/|hooks/|store/|pages/|middleware\.ts|\.(ts|tsx|js|jsx|mjs|cjs)([^A-Za-z]|$))' || return 1
  return 0
}

gate_write() {
  local rel; rel="$(rel_to_root "$1")"
  case "$rel" in /*) exit 0;; esac        # outside the repo -> not our concern
  if ! config_ok; then                    # gate degraded -> fail CLOSED for code
    if printf '%s' "$rel" | grep -qE "$FALLBACK_CODE_RE"; then
      printf 'SDD gate DEGRADED: tooling/sdd.config.json is missing/unreadable (or jq is absent), so the spec-first sequence cannot be verified. Blocking the code write to "%s" until the gate is restored. Fail-closed by design.' "$rel"
      exit 10
    fi
    exit 0
  fi
  is_gated "$rel" || exit 0               # not implementation -> allow
  impl_allowed && exit 0                  # gate satisfied -> allow
  printf 'SDD gate: write to "%s" blocked. Spec-first gate not met — commit %s under %s/ (run /specify -> /plan -> /tasks, committing each as its own commit) before any implementation code.' \
    "$rel" "$(missing_artifacts)" "$(cfgval '.specDir')"
  exit 10
}

emit() { jq -nc --arg d "$1" --arg r "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'; }

cmd_hook() {
  local input tool fp cmd reason
  input="$(cat)"
  tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
  case "$tool" in
    Write|Edit|MultiEdit)
      fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
      [[ -z "$fp" ]] && exit 0
      if reason="$("$0" gate-write "$fp")"; then exit 0
      else emit deny "$reason  [deterministic SDD gate; commit the spec artifacts first, or run the write yourself outside the agent]"; exit 0; fi
      ;;
    Bash)
      cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
      [[ -z "$cmd" ]] && exit 0
      impl_allowed && exit 0              # gate open -> Bash writes are fine
      if bash_writes_gated "$cmd"; then
        emit deny "SDD gate: this Bash command looks like it writes code into a gated path, and the spec-first gate is not met (missing $(missing_artifacts)). Commit spec/plan/tasks first. If this is NOT a code write (a false positive on the coarse tripwire), run it yourself outside the agent. [coarse Bash tripwire]"
        exit 0
      fi
      exit 0
      ;;
    *) exit 0;;
  esac
}

cmd_status() {
  if ! config_ok; then
    echo "SDD status @ $ROOT"
    echo "  !! GATE DEGRADED: tooling/sdd.config.json missing/unreadable (or jq absent). Code writes fail CLOSED until fixed."
    exit 1
  fi
  local p v; p="$(phase)"
  echo "SDD status @ $ROOT"
  echo "  phase: $p"
  printf '  committed: spec=%s plan=%s tasks=%s\n' \
    "$(committed "$SPEC_ART" && echo yes || echo NO)" \
    "$(committed "$PLAN_ART" && echo yes || echo NO)" \
    "$(committed "$TASKS_ART" && echo yes || echo NO)"
  impl_allowed && echo "  implementation: ALLOWED" || echo "  implementation: BLOCKED (missing $(missing_artifacts))"
  v="$(violation)"; [[ -n "$v" ]] && echo "  !! $v"
  case "$p" in
    init) echo "  next: /specify -> rewrite in your own words -> commit specs/NNN/spec.md";;
    spec) echo "  next: /plan -> tag each decision to an invariant -> commit plan.md";;
    plan) echo "  next: /tasks -> tag each task to an invariant -> commit tasks.md";;
    impl) echo "  next: implement task-by-task, one commit each referencing (Tnnn, INV-x); run 'sdd-check.sh audit' before submit";;
  esac
}

cmd_audit() {
  config_ok || { echo "AUDIT: config unreadable"; exit 2; }
  local ok=1 a
  for a in spec plan tasks; do
    committed "$(cfgval ".artifacts.$a")" || { echo "AUDIT FAIL: ${a}.md was never committed."; ok=0; }
  done
  [[ $ok -eq 0 ]] && exit 1
  local tcommit icommit specs
  tcommit="$(git -C "$ROOT" log --diff-filter=A --format=%H --reverse -- "$TASKS_ART" 2>/dev/null | head -1)"
  specs="$(impl_pathspecs)"
  icommit="$(git -C "$ROOT" log --format=%H --reverse -- $specs 2>/dev/null | head -1)"
  if [[ -z "$icommit" ]]; then echo "AUDIT: spec/plan/tasks committed; no implementation committed yet."; exit 0; fi
  if [[ "$icommit" == "$tcommit" ]]; then
    echo "AUDIT FAIL: implementation and tasks.md are in the SAME commit — the history does not show spec-before-code (squashed or batched?). Fix before submitting."; exit 1
  fi
  if git -C "$ROOT" merge-base --is-ancestor "$icommit" "$tcommit" 2>/dev/null; then
    echo "AUDIT FAIL: the first implementation commit precedes tasks.md — spec-first sequence is broken in the history."; exit 1
  fi
  echo "AUDIT PASS: spec, plan, and tasks are each committed before the first implementation commit."
  exit 0
}

selftest() {
  config_ok || { echo "selftest needs a readable tooling/sdd.config.json"; exit 1; }
  local t; t="$(mktemp -d)"
  mkdir -p "$t/tooling"
  cp "$CFG" "$t/tooling/sdd.config.json"
  cp "$0"  "$t/tooling/sdd-check.sh"; chmod +x "$t/tooling/sdd-check.sh"
  git -C "$t" init -q; git -C "$t" config user.email a@b.c; git -C "$t" config user.name t
  printf 'node_modules\n' > "$t/.gitignore"
  git -C "$t" add .gitignore tooling; git -C "$t" commit -qm scaffold
  local SC="$t/tooling/sdd-check.sh" pass=0 fail=0
  ck() { ( cd "$t" && "$SC" gate-write "$2" >/dev/null 2>&1 ); local rc=$?; local got=ALLOW; [[ $rc -ne 0 ]] && got=DENY
    if [[ "$got" == "$1" ]]; then pass=$((pass+1)); else fail=$((fail+1)); printf '  FAIL exp %-5s got %-5s : %s\n' "$1" "$got" "$2"; fi; }
  echo "== init: nothing committed =="
  ck DENY  src/domain/articles.ts
  ck DENY  app/api/articles/route.ts
  ck DENY  app/page.tsx
  ck DENY  lib/db.ts
  ck DENY  server/handler.ts
  ck DENY  components/Table.tsx
  ck DENY  middleware.ts
  ck DENY  tests/lifecycle.test.ts
  ck DENY  anything.test.ts
  ck DENY  ./src/x.ts
  ck DENY  "$t/specs/../src/x.ts"
  ck DENY  src/x.config.ts
  ck ALLOW README.md
  ck ALLOW specs/001-docs-studio/spec.md
  ck ALLOW tooling/sdd-check.sh
  ck ALLOW package.json
  ck ALLOW next.config.ts
  ck ALLOW tsconfig.json
  ck ALLOW next-env.d.ts
  ck ALLOW app/globals.css
  ck ALLOW /tmp/elsewhere/src/x.ts
  mkdir -p "$t/specs/001-docs-studio"
  printf 'spec\n' > "$t/specs/001-docs-studio/spec.md"
  printf 'plan\n' > "$t/specs/001-docs-studio/plan.md"
  git -C "$t" add specs; git -C "$t" commit -qm "spec+plan"
  echo "== spec+plan committed, tasks missing =="
  ck DENY  src/domain/articles.ts
  printf 'tasks\n' > "$t/specs/001-docs-studio/tasks.md"
  git -C "$t" add specs; git -C "$t" commit -qm "tasks"
  echo "== all three committed =="
  ck ALLOW src/domain/articles.ts
  ck ALLOW app/page.tsx
  ck ALLOW lib/db.ts
  printf 'SELFTEST: %s passed, %s failed\n' "$pass" "$fail"
  rm -rf "$t"
  [[ $fail -eq 0 ]]
}

case "${1:-}" in
  status)     cmd_status;;
  gate-write) shift; gate_write "${1:-}";;
  hook)       cmd_hook;;
  audit)      cmd_audit;;
  --selftest) selftest;;
  *) echo "usage: sdd-check.sh {status | gate-write <path> | hook | audit | --selftest}"; exit 2;;
esac
