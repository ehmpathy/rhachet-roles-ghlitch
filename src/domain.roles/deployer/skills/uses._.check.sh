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

while [[ $# -gt 0 ]]; do
  case $1 in
    # crash-safe value reads (see uses._.local.sh): a bare `--meter`/`--env` won't
    # crash under `set -e`; the absent-arg check below reports it as exit 2.
    --meter) METER="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --env) ENV="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --repo|--role|--skill) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --) shift ;;
    *) shift ;;
  esac
done

if [[ -z "$METER" || -z "$ENV" ]]; then
  echo "error: uses.check requires --meter and --env" >&2
  exit 2
fi

# non-prod envs are never gated
if [[ "$ENV" != "prod" ]]; then
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
