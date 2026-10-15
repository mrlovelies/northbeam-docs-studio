#!/usr/bin/env bash
# sdd-session.sh — SessionStart hook. Two jobs:
#   1) Dead-man liveness: if the SDD gate cannot actually run, say so LOUDLY.
#      A silent fail-open is the failure that most fools a cooperative user into
#      believing he is protected when he is not.
#   2) Re-ground: inject the current phase + rules from ground truth, so a cold
#      or context-compacted agent re-learns where it is without trusting a summary.
# Read-only. Never blocks a session. Exits 0.
#
# OUTPUT (stdout): { hookSpecificOutput: { additionalContext } }.
set -uo pipefail

SELF="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
ROOT="$(dirname "$SELF")"
SDD="$SELF/sdd-check.sh"
CFG="$SELF/sdd.config.json"

p=""
command -v git >/dev/null 2>&1 || p="${p}\n  - git not found"
command -v jq  >/dev/null 2>&1 || p="${p}\n  - jq not found"
[[ -x "$SDD" ]] || p="${p}\n  - sdd-check.sh is missing or not executable"
{ [[ -f "$CFG" ]] && command -v jq >/dev/null 2>&1 && jq -e . "$CFG" >/dev/null 2>&1; } || p="${p}\n  - sdd.config.json is missing or unreadable"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || p="${p}\n  - not inside the project git repo"

if [[ -n "$p" ]]; then
  msg="SDD GATE OFFLINE — spec-first enforcement is NOT active right now:${p}\n\nImplementation writes are NOT being gated. A silent fail-open is exactly what this check exists to catch. Tell Alex before doing any build work, and do not assume the gate is protecting you."
else
  st="$("$SDD" status 2>/dev/null)"
  msg="SDD GATE ACTIVE. Current state, re-read fresh from git (trust this over any summary):\n\n${st}\n\nBuild rules (the gate enforces these on Write/Edit AND Bash):\n  1. Spec before code: commit spec.md -> plan.md -> tasks.md (each its own commit) before any implementation.\n  2. No squash or history rewrite of that sequence. Run 'tooling/sdd-check.sh audit' before submitting.\n  3. One commit per task, referencing (Tnnn, INV-x).\nAfter any context loss, re-read specs/*/spec.md and plan.md to re-ground. The committed artifacts are the durable memory, not this note."
fi

if command -v jq >/dev/null 2>&1; then
  printf '%b' "$msg" | jq -Rsc '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}'
else
  printf '%b\n' "$msg"
fi
exit 0
