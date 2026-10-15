#!/usr/bin/env bash
# sdd-stress.sh — adversarial stress test for the SDD gate.
# Goes beyond --selftest: bypass attempts, the hook contract, the Bash tripwire,
# the audit (no-squash), canonicalization, fail-closed, and the documented limits.
# Throwaway repos only. Exits non-zero on any failure, so it can gate CI.
set -uo pipefail

SELF="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
SRC_SDD="$SELF/sdd-check.sh"
SRC_CFG="$SELF/sdd.config.json"
PASS=0; FAIL=0; TMPS=""
trap 'for d in $TMPS; do rm -rf "$d"; done' EXIT

note()   { printf '\n== %s ==\n' "$1"; }
okfail() { if [[ "$1" == "$2" ]]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$3"; else FAIL=$((FAIL+1)); printf '  FAIL %s (exp=%s got=%s)\n' "$3" "$1" "$2"; fi; }

mkrepo() {
  local d; d="$(mktemp -d)"; TMPS="$TMPS $d"
  mkdir -p "$d/tooling"
  cp "$SRC_CFG" "$d/tooling/sdd.config.json"; cp "$SRC_SDD" "$d/tooling/sdd-check.sh"; chmod +x "$d/tooling/sdd-check.sh"
  git -C "$d" init -q; git -C "$d" config user.email a@b.c; git -C "$d" config user.name t
  printf 'node_modules\n' > "$d/.gitignore"
  git -C "$d" add .gitignore tooling; git -C "$d" commit -qm scaffold
  printf '%s' "$d"
}
add_spec()  { mkdir -p "$1/specs/001"; printf '%s' "${2-real spec}"  > "$1/specs/001/spec.md";  git -C "$1" add specs; git -C "$1" commit -qm spec; }
add_plan()  { printf '%s' "${2-real plan}"  > "$1/specs/001/plan.md";  git -C "$1" add specs; git -C "$1" commit -qm plan; }
add_tasks() { printf '%s' "${2-real tasks}" > "$1/specs/001/tasks.md"; git -C "$1" add specs; git -C "$1" commit -qm tasks; }
commit_impl() { mkdir -p "$1/src"; printf 'x' > "$1/src/x.ts"; git -C "$1" add src; git -C "$1" commit -qm "${2:-impl}"; }

gw() { ( cd "$1" && "$1/tooling/sdd-check.sh" gate-write "$2" >/dev/null 2>&1 ) && echo ALLOW || echo DENY; }
ckgw() { okfail "$1" "$(gw "$2" "$3")" "$4"; }

hookres() { local out; out="$(printf '%s' "$2" | ( cd "$1" && "$1/tooling/sdd-check.sh" hook 2>/dev/null ))"; case "$out" in *'"permissionDecision":"deny"'*) echo DENY;; *) echo ALLOW;; esac; }
ckhook() { okfail "$1" "$(hookres "$2" "$3")" "$4"; }

auditres() { ( cd "$1" && "$1/tooling/sdd-check.sh" audit >/dev/null 2>&1 ) && echo PASS || echo FAIL; }
ckaudit() { okfail "$1" "$(auditres "$2")" "$3"; }

hasviol() { local out; out="$( cd "$1" && "$1/tooling/sdd-check.sh" status 2>/dev/null )"; case "$out" in *VIOLATION*) echo YES;; *) echo NO;; esac; }
ckviol() { okfail "$1" "$(hasviol "$2")" "$3"; }

# ---- precondition: the fast selftest must still be green ----
note "precondition: --selftest"
if "$SRC_SDD" --selftest >/dev/null 2>&1; then PASS=$((PASS+1)); printf '  ok   selftest 25/25\n'; else FAIL=$((FAIL+1)); printf '  FAIL selftest regressed\n'; fi

note "positive: legit flow never obstructed"
R="$(mkrepo)"
ckgw ALLOW "$R" specs/001/spec.md "spec writable at init"
ckgw ALLOW "$R" README.md         "README writable"
ckgw ALLOW "$R" package.json      "package.json writable"
ckgw ALLOW "$R" next.config.ts    "next.config.ts writable"
ckgw ALLOW "$R" app/globals.css   "css writable"
ckgw DENY  "$R" src/domain/x.ts   "src impl denied at init"
add_spec "$R"; ckgw DENY "$R" src/domain/x.ts "spec-only still denies"
add_plan "$R"; ckgw DENY "$R" src/domain/x.ts "spec+plan still denies (tasks missing)"
add_tasks "$R"; ckgw ALLOW "$R" src/domain/x.ts "impl allowed after all three"
ckgw ALLOW "$R" app/page.tsx "ui allowed after all three"

note "widened globs: impl outside src/ is gated"
W="$(mkrepo)"
for pth in lib/db.ts server/h.ts db/schema.ts components/T.tsx middleware.ts app/page.tsx app/actions.ts main.ts utils.ts; do
  ckgw DENY "$W" "$pth" "gated: $pth"
done

note "canonicalization + config-shadow"
ckgw DENY  "$W" ./src/x.ts        "leading ./ canonicalized -> gated"
ckgw DENY  "$W" specs/../src/x.ts "../ escape canonicalized -> gated"
ckgw DENY  "$W" src/x.config.ts   "config-shadow closed -> gated"
ckgw ALLOW "$W" next.config.ts    "named config allowed"
ckgw ALLOW "$W" "/tmp/outside/src/x.ts" "outside repo -> allow"

note "hook contract (Write + Bash tripwire)"
ckhook DENY  "$W" '{"tool_name":"Write","tool_input":{"file_path":"'"$W"'/src/x.ts"}}'  "Write to src pre-spec -> deny"
ckhook ALLOW "$W" '{"tool_name":"Write","tool_input":{"file_path":"'"$W"'/README.md"}}' "Write to README -> allow"
ckhook DENY  "$W" '{"tool_name":"Bash","tool_input":{"command":"echo x > src/x.ts"}}'   "Bash write into src -> deny"
ckhook DENY  "$W" '{"tool_name":"Bash","tool_input":{"command":"cat > lib/db.ts <<EOF"}}' "Bash heredoc into lib -> deny"
ckhook ALLOW "$W" '{"tool_name":"Bash","tool_input":{"command":"echo x > README.md"}}'  "Bash write to README -> allow"
ckhook ALLOW "$W" '{"tool_name":"Bash","tool_input":{"command":"cat src/x.ts"}}'        "Bash read src -> allow"
ckhook ALLOW "$W" '{"tool_name":"Bash","tool_input":{"command":"npm run test"}}'        "Bash npm test -> allow"
ckhook ALLOW "$W" '{"tool_name":"Read","tool_input":{"file_path":"'"$W"'/src/x.ts"}}'   "Read tool -> allow"

note "documented limit: stub spec opens the gate (sequence, not content)"
S="$(mkrepo)"; add_spec "$S" ""; add_plan "$S" ""; add_tasks "$S" ""
ckgw ALLOW "$S" src/x.ts "stub spec -> impl allowed [LIMIT by design]"

note "violation detection (status)"
V="$(mkrepo)"; commit_impl "$V" "impl early"
ckviol YES "$V" "impl committed, tasks absent -> flagged"
add_spec "$V"; add_plan "$V"; add_tasks "$V"
ckviol YES "$V" "impl before tasks -> still flagged"
C="$(mkrepo)"; add_spec "$C"; add_plan "$C"; add_tasks "$C"; commit_impl "$C"
ckviol NO "$C" "clean order -> no violation"

note "audit (guards no-squash)"
ckaudit PASS "$C" "clean sequence -> audit PASS"
ckaudit FAIL "$V" "impl-before-tasks -> audit FAIL"
Q="$(mktemp -d)"; TMPS="$TMPS $Q"
mkdir -p "$Q/tooling" "$Q/specs/001" "$Q/src"
cp "$SRC_CFG" "$Q/tooling/sdd.config.json"; cp "$SRC_SDD" "$Q/tooling/sdd-check.sh"; chmod +x "$Q/tooling/sdd-check.sh"
git -C "$Q" init -q; git -C "$Q" config user.email a@b.c; git -C "$Q" config user.name t
printf 's'>"$Q/specs/001/spec.md"; printf 'p'>"$Q/specs/001/plan.md"; printf 't'>"$Q/specs/001/tasks.md"; printf 'x'>"$Q/src/x.ts"
git -C "$Q" add -A; git -C "$Q" commit -qm "everything squashed into one commit"
ckaudit FAIL "$Q" "squash (all in one commit) -> audit FAIL"

note "fail-closed on broken config"
F="$(mkrepo)"; rm -f "$F/tooling/sdd.config.json"
ckgw DENY  "$F" src/x.ts  "code write blocked when config unreadable"
ckgw ALLOW "$F" README.md "non-code allowed when config unreadable"

printf '\nSTRESS: %s passed, %s failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
