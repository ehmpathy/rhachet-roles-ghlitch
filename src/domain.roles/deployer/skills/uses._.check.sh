#!/usr/bin/env bash
######################################################################
# 🦺 uses.check — the prod gate consumer skills call before a prod write
#
# .what = decides allow/block for a meter+env, decrements quota grants,
#         and auto-revokes a quota that hits zero
#
# .why  = central choke point so deploy/provision skills stay simple:
#         one call, exit 0 = proceed, exit 2 = blocked (with hint)
#
# usage (from a consumer skill, only for prod writes):
#   "$DIR/uses._.check.sh" --meter deploy.uses --env prod || exit $?
#
# behavior (only a LOCAL grant permits prod; org allow never grants on its own):
#   - env != prod          → exit 0 (non-prod is never gated)
#   - --gate for-cicd (CI) → defer to the github-environment approval; exit 0
#                            (skips the local meter — see the cicd-gate block below)
#   - local quota grant    → decrement; auto-revoke at zero; exit 0
#   - local unlimited grant→ exit 0 (no decrement)
#   - blocked (global/org freeze, local revoke, or no local grant)
#                          → escalation hint on stderr; exit 2
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/uses._.output.sh"
source "$SCRIPT_DIR/uses._.operations.sh"

# .what = reject a valued flag whose value is absent or is itself a flag
# .why  = both consumer skills (provision.declastruct, provision.database) guard every
#         valued flag this way, and this gate did not — so `--gate` alone, or
#         `--gate --env prod`, set GATE="" / GATE="--env" and fell through to the generic
#         enum belay. that belay names the SYMPTOM ("invalid gate: ") and never the cause
#         (no value was supplied), which is the vague half of
#         rule.require.errors-name-the-fix — and an inconsistency across the very contract
#         this route unified (rule.require.consistent-skill-contracts).
#
#         mirrors provision.declastruct.sh:110 in shape and in message, so a caller who
#         meets it here reads the same words they would there.
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}"),
  # $3 = optional comma-joined valid set, for a flag whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    print_cat_header "belay that..." >&2
    print_tree_start "🦺 uses.check" >&2
    echo "   ├─ absent value for $1" >&2
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3" >&2
    echo "   └─ hint: the skill that composes this gate supplies it" >&2
    exit 2
  fi
}

# .what = close this gate's output block, so the composer's own output cannot collide
#         with it
# .why  = this skill is composed by five deployer skills (provision.declastruct,
#         provision.database, provision.terraform, aws.cloudformation.rollback, deploy)
#         and, on the paths that PASS, it hands control back and the composer prints its
#         own two-header block next. with no seam the two collide at column 0:
#
#           🦺 provision.uses --env prod --gate for-cicd
#              └─ authorized via github-environment approval (CI)
#           🐈 belay that...              ← a new skill starts mid-air
#
#         every other mascot header in the family is preceded by a blank line; this one
#         was not, because it is the SECOND skill's header butting against the FIRST
#         skill's last line (rule.require.nest-subskill-output-in-buckets, whose concern
#         is exactly "two headers stacked with no delineation").
#
#         .why a seam and NOT a run_sub_bucket: a bucket expresses CONTAINMENT — a child
#         doing work as part of a parent's in-progress tree, which is the
#         provision.database → use.rds.capacity shape. this gate is not that. it is a
#         PRECONDITION: it runs to completion before the composer's header exists, and it
#         may terminate the run outright. there is no parent tree to indent beneath, and
#         to invent one would force each composer to print a second ⛵ header purely to
#         host the frame. sequence gets a seam; containment gets a bucket.
#
#         only the pass-paths call this. a belay exits 2, so the composer emits no further
#         output and a trailing blank would just be noise before the shell prompt.
#
#         goes to stderr, matching the lines it closes — a caller that captures stdout to
#         grep a forward contract must never see it.
close_gate_block() {
  echo "" >&2
}

METER=""
ENV=""
# --gate names which caller-kind's approval clears a prod write. it defaults to
# for-ehmpath (the quota a human granted the agent), which is what an omitted flag has
# always meant here — now stated rather than implied. the word matches every consumer
# skill's own --gate, so no caller translates at the boundary
# (rule.require.consistent-skill-contracts).
GATE="for-ehmpath"

while [[ $# -gt 0 ]]; do
  case $1 in
    # every valued flag guards its value first, so a bare `--gate` (last token) or a
    # `--gate --env prod` (flag-as-value) belays by NAME instead of a `set -u` crash or a
    # generic enum mismatch. `shift 2` is safe only because require_val has already proven
    # a value is there — do not reorder these two.
    --meter) require_val --meter "${2:-}"; METER="$2"; shift 2 ;;
    --env) require_val --env "${2:-}"; ENV="$2"; shift 2 ;;
    --gate) require_val --gate "${2:-}" "for-ehmpath, for-cicd"; GATE="$2"; shift 2 ;;
    # --auth is RETIRED — the whole flag. it MUST be caught by name, because the `*)` arm
    # below silently discards an unknown flag, so a legacy `--auth as-cicd` would fall
    # through to the default gate, hit the local meter, and the caller would read "prod is
    # locked" with no clue their flag was dropped. that is a prod-write authorization
    # decision made by a silently-ignored argument (rule.forbid.failhide).
    #
    # the message holds for EVERY value, never just as-cicd: this skill takes no --auth at
    # all, so an answer of the form "use --gate for-cicd" would be a wrong fix for any
    # other value — worse than a bare rejection (rule.forbid.surprises).
    --auth)
      print_cat_header "belay that..." >&2
      print_tree_start "🦺 uses.check" >&2
      echo "   ├─ retired flag: --auth (this skill takes no credential channel)" >&2
      echo "   ├─ fix: for prod-write approval use --gate for-ehmpath|for-cicd" >&2
      echo "   └─ note: --auth as-cicd is now --gate for-cicd" >&2
      exit 2
      ;;
    --repo|--role|--skill) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --) shift ;;
    # an unknown FLAG belays. it used to be swallowed by a bare `*) shift ;;`, which made
    # every typo a silent authorization decision: `--grate for-cicd` fell through to the
    # default gate, hit the local meter, and the caller read "prod is locked" with no clue
    # their flag was dropped — the exact failhide shape the `--auth` arm above was added to
    # dodge, one flag at a time. one flag at a time does not scale, so the class is closed
    # here (rule.forbid.failhide, rule.require.failfast-on-omitted-input).
    --*)
      print_cat_header "belay that..." >&2
      print_tree_start "🦺 uses.check" >&2
      echo "   ├─ unknown flag: $1" >&2
      echo "   └─ valid: --meter, --env, --gate" >&2
      exit 2
      ;;
    # a bare positional is still tolerated: rhachet may append tokens this skill has no
    # use for, and they carry no authorization sense. only a `--flag` can be mistaken for
    # an instruction that was honored, so only a `--flag` belays.
    *) shift ;;
  esac
done

if [[ -z "$METER" || -z "$ENV" ]]; then
  print_cat_header "belay that..." >&2
  print_tree_start "🦺 uses.check" >&2
  echo "   ├─ absent required args: --meter and --env" >&2
  echo "   └─ hint: both are supplied by the skill that composes this gate" >&2
  exit 2
fi

# --auth as-cicd is RETIRED here too, so the whole deployer family speaks one word for
# one purpose (rule.require.consistent-skill-contracts). it named a credential source and
# an approval authority at once; --gate now carries the approval half alone. the
# retirement is caught at the FLAG, in the arg parse above, which is where a real
# migration lands: a caller who carries the old contract types --auth. a `--gate as-cicd`
# falls to the enum guard below, same as any other bad value, same as every kin skill.

# validate --gate — fail loud on a typo rather than silently ignore it. an ignored value
# would fall back to the local meter, which could read as an opt into the cicd gate when
# it was not — a prod-write authorization decision made by a typo.
if [[ "$GATE" != "for-ehmpath" && "$GATE" != "for-cicd" ]]; then
  print_cat_header "belay that..." >&2
  print_tree_start "🦺 uses.check" >&2
  echo "   ├─ invalid gate: $GATE" >&2
  echo "   └─ must be: for-ehmpath or for-cicd" >&2
  exit 2
fi

# non-prod envs are never gated
if [[ "$ENV" != "prod" ]]; then
  exit 0
fi

# cicd gate — an explicit opt-in that defers prod authorization to the ambient
# github-environment approval + tag ruleset (enforced by github BEFORE this job
# runs) instead of the local meter. this is how a prod apply gets authorized
# in CI, where no local quota grant exists.
#
# guard: require an ambient CI marker (CI=true, set by github actions) so a local
# shell that passes --gate for-cicd by mistake can NEVER skip the meter. the flag is
# the opt-in; the CI marker proves we are truly in the trusted CI context. absent it,
# fail loud (constraint) rather than bypass the local gate — an explicit opt-in,
# not a silent CI=true bypass.
#
# note: the local/org/global meter files live in a human's ~/.rhachet storage, which
# is absent on an ephemeral CI runner — so there is no local freeze to honor here;
# the github environment is the sole prod authority in CI.
if [[ "$GATE" == "for-cicd" ]]; then
  if [[ "${CI:-}" != "true" ]]; then
    print_cat_header "belay that..." >&2
    print_tree_start "🦺 $METER --env prod --gate for-cicd" >&2
    echo "   ├─ --gate for-cicd requires the CI environment (CI=true), which is absent" >&2
    echo "   └─ the cicd gate defers to the github-environment approval; run it in CI" >&2
    exit 2
  fi
  # ambient CI confirmed — the github-environment approval is the authorization.
  # emit a visible line so the CI log shows WHY prod was permitted; a silent prod
  # authorization would be a surprise (see rule.forbid.surprises). goes to stderr so a
  # caller that captures stdout (e.g. to grep schema output) is never polluted.
  print_tree_start "🦺 $METER --env prod --gate for-cicd" >&2
  echo "   └─ authorized via github-environment approval (CI)" >&2
  close_gate_block
  exit 0
fi

require_git_repo

# fail loud on a corrupt state file BEFORE the decision. done at top level (not
# inside $()) so the exit propagates — a corrupt gate file must never read as a
# silent default that could grant prod or lift a freeze unseen.
get_global_paths "$METER"
get_local_paths "$METER"
assert_meter_file_valid "$GLOBAL_STATE_FILE"
assert_meter_file_valid "$ORG_STATE_FILE"
assert_meter_file_valid "$LOCAL_STATE_FILE"

# if org policy is configured, we MUST identify this repo's org to apply it.
# a misread here could silently bypass an org freeze, so fail loud rather than
# guess. (no org file → org plays no part; keyrack is not needed.)
if [[ -f "$ORG_STATE_FILE" ]] && ! get_org_from_keyrack; then
  print_cat_header "wet paws..." >&2
  print_tree_start "🦺 $METER --env prod" >&2
  echo "   └─ org policy set but repo org unreadable: $ORG_ERROR" >&2
  exit 1
fi

DECISION=$(decide_uses "$METER" "$ENV")

case "$DECISION" in
  allowed:local:infinite)
    # local unlimited grant — no decrement
    # note: there is no "allowed:org" — an org allow never grants on its own;
    # only a local grant reaches an "allowed:*" outcome.
    exit 0
    ;;
  allowed:local:*)
    # quota grant — decrement, auto-revoke at zero
    LEFT="${DECISION##*:}"
    NEW=$((LEFT - 1))
    write_local_uses "$METER" "$ENV" "$NEW"
    if [[ "$NEW" -le 0 ]]; then
      echo "🐈 $METER: prod use consumed ($LEFT → 0, re-locked)" >&2
    else
      echo "🐈 $METER: prod use consumed ($LEFT → $NEW left)" >&2
    fi
    close_gate_block
    exit 0
    ;;
  blocked:global)
    print_cat_header "wet paws..." >&2
    print_tree_start "🦺 $METER --env prod" >&2
    echo "   ├─ prod is locked: global freeze in effect" >&2
    echo "   └─ a human must lift it: rhx $METER allow --global" >&2
    exit 2
    ;;
  *)
    # blocked:local | blocked:org | blocked:unset
    print_cat_header "wet paws..." >&2
    print_tree_start "🦺 $METER --env prod" >&2
    echo "   ├─ prod is locked: no $METER grant for prod (safe default)" >&2
    echo "   └─ ask your human to grant:" >&2
    echo "        \$ rhx $METER set --quant 1 --env prod" >&2
    exit 2
    ;;
esac
