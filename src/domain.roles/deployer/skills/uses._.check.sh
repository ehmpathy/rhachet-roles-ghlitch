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
#   - --auth as-cicd (CI)  → defer to the github-environment approval; exit 0
#                            (skips the local meter — see the cicd-auth block below)
#   - local quota grant    → decrement; auto-revoke at zero; exit 0
#   - local unlimited grant→ exit 0 (no decrement)
#   - blocked (global/org freeze, local revoke, or no local grant)
#                          → escalation hint on stderr; exit 2
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/uses._.output.sh"
source "$SCRIPT_DIR/uses._.operations.sh"

METER=""
ENV=""
AUTH=""

while [[ $# -gt 0 ]]; do
  case $1 in
    # crash-safe value reads (see uses._.local.sh): a bare `--meter`/`--env` won't
    # crash under `set -e`; the absent-arg check below reports it as exit 2.
    --meter) METER="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --env) ENV="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --auth) AUTH="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --repo|--role|--skill) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --) shift ;;
    *) shift ;;
  esac
done

if [[ -z "$METER" || -z "$ENV" ]]; then
  echo "error: uses.check requires --meter and --env" >&2
  exit 2
fi

# validate --auth if supplied — only "as-cicd" is a recognized auth source. fail loud
# on a typo rather than silently ignore it (an ignored --auth could look like it opted
# into the cicd auth when it did not).
if [[ -n "$AUTH" && "$AUTH" != "as-cicd" ]]; then
  echo "error: uses.check --auth must be 'as-cicd' (got: $AUTH)" >&2
  exit 2
fi

# non-prod envs are never gated
if [[ "$ENV" != "prod" ]]; then
  exit 0
fi

# cicd auth — an explicit opt-in that defers prod authorization to the ambient
# github-environment approval + tag ruleset (enforced by github BEFORE this job
# runs) instead of the local human meter. this is how a prod apply gets authorized
# in CI, where no local quota grant exists.
#
# guard: require an ambient CI marker (CI=true, set by github actions) so a local
# shell that passes --auth as-cicd by mistake can NEVER skip the meter. the flag is
# the opt-in; the CI marker proves we are truly in the trusted CI context. absent it,
# fail loud (constraint) rather than bypass the local gate — an explicit opt-in,
# not a silent CI=true bypass.
#
# note: the local/org/global meter files live in a human's ~/.rhachet storage, which
# is absent on an ephemeral CI runner — so there is no local freeze to honor here;
# the github environment is the sole prod authority in CI.
if [[ "$AUTH" == "as-cicd" ]]; then
  if [[ "${CI:-}" != "true" ]]; then
    print_cat_header "belay that..." >&2
    print_tree_start "🦺 $METER --env prod --auth as-cicd" >&2
    echo "   ├─ --auth as-cicd requires the CI environment (CI=true), which is absent" >&2
    echo "   └─ cicd auth defers to the github-environment approval; run it in CI" >&2
    exit 2
  fi
  # ambient CI confirmed — the github-environment approval is the authorization.
  # emit a visible line so the CI log shows WHY prod was permitted; a silent prod
  # authorization would be a surprise (see rule.forbid.surprises). goes to stderr so a
  # caller that captures stdout (e.g. to grep schema output) is never polluted.
  print_tree_start "🦺 $METER --env prod --auth as-cicd" >&2
  echo "   └─ authorized via github-environment approval (CI)" >&2
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
