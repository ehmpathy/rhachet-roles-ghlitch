#!/usr/bin/env bash
######################################################################
# .what = manage local (this-repo) prod-gate grant for a *.uses meter
#
# .why  = humans grant deploy/provision access to prod in this repo,
#         env-keyed, with local config that wins over org and global
#
# .how  = invoked by the uses._.sh dispatcher with --meter <name>.
#         grants are keyed by --env (only prod is gated by callers).
#
# usage (via dispatcher, e.g. deploy.uses / provision.uses):
#   <meter> set --quant 1 --env prod    # grant 1 prod use (one-shot)
#   <meter> set --quant infinite --env prod
#   <meter> allow --env prod            # unlimited grant
#   <meter> block --env prod            # explicit revoke (wins over org)
#   <meter> del --env prod              # remove local, defer to org/global
#   <meter> get                         # check state across scopes
#
# guarantee:
#   - --env required for set/allow/block/del (no default; fail-fast)
#   - state stored in .meter/<meter>.jsonc (env-keyed)
#   - local state wins over org and global
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/uses._.output.sh"
source "$SCRIPT_DIR/uses._.operations.sh"

require_git_repo

# parse args
METER=""
COMMAND=""
QUANT=""
ENV=""

while [[ $# -gt 0 ]]; do
  case $1 in
    # crash-safe value reads: shift past the flag, then shift past the value only
    # if one is present. an absent value (e.g. a bare `--env` at the end) leaves
    # the var empty for the downstream absent-arg check to report as a clean
    # exit 2, instead of a `set -e` crash on `shift 2`.
    --meter) METER="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    set|allow|block|del|get) COMMAND="$1"; shift ;;
    --quant) QUANT="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --env) ENV="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --help|-h)
      echo "usage: <meter> set --quant N --env prod"
      echo "       <meter> allow --env prod"
      echo "       <meter> block --env prod"
      echo "       <meter> del --env prod"
      echo "       <meter> get"
      exit 0
      ;;
    --repo|--role|--skill|--local) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --) shift ;;
    --*)
      print_cat_header "belay that..."
      print_tree_start "🦺 ${METER:-<meter>}"
      print_tree_error "unknown option: $1"
      exit 2
      ;;
    *) shift ;;
  esac
done

# validate meter (set by dispatcher)
if [[ -z "$METER" ]]; then
  echo "error: --meter required (set by dispatcher)" >&2
  exit 2
fi

# validate command
if [[ -z "$COMMAND" ]]; then
  echo "error: command required (set, allow, block, del, or get)" >&2
  exit 2
fi

# mutation commands require TTY (human only)
case "$COMMAND" in
  set|allow|block|del) require_human "$METER $COMMAND" ;;
esac

# mutations require --env (no default; fail-fast)
case "$COMMAND" in
  set|allow|block|del)
    if [[ -z "$ENV" ]]; then
      print_cat_header "belay that..."
      print_tree_start "🦺 $METER $COMMAND"
      print_tree_error "absent required arg: --env (e.g. --env prod)"
      exit 2
    fi
    ;;
esac

case "$COMMAND" in
  set)
    # validate --quant
    if [[ -z "$QUANT" ]]; then
      print_cat_header "belay that..."
      print_tree_start "🦺 $METER set"
      print_tree_error "absent required arg: --quant N (or 'infinite')"
      exit 2
    fi
    if [[ "$QUANT" != "infinite" ]] && ! [[ "$QUANT" =~ ^[0-9]+$ ]]; then
      print_cat_header "belay that..."
      print_tree_start "🦺 $METER set"
      print_tree_error "--quant must be a non-negative integer or 'infinite'"
      exit 2
    fi
    write_local_uses "$METER" "$ENV" "$QUANT"
    print_cat_header "smooth sailin!"
    print_tree_start "🦺 $METER set"
    echo "   ├─ granted: $QUANT"
    echo "   ├─ env: $ENV"
    echo "   └─ scope: local (this repo)"
    ;;

  allow)
    write_local_uses "$METER" "$ENV" "infinite"
    print_cat_header "smooth sailin!"
    print_tree_start "🦺 $METER allow"
    echo "   ├─ granted: unlimited"
    echo "   ├─ env: $ENV"
    echo "   └─ scope: local (this repo)"
    ;;

  block)
    # explicit local revoke (uses=0) — wins over org policy
    write_local_uses "$METER" "$ENV" 0
    print_cat_header "anchors away!"
    print_tree_start "🦺 $METER block"
    echo "   ├─ revoked (local)"
    echo "   └─ env: $ENV"
    ;;

  del)
    del_local_uses "$METER" "$ENV"
    print_cat_header "anchors away!"
    print_tree_start "🦺 $METER del"
    echo "   ├─ local config removed for env: $ENV"
    echo "   └─ defers to org/global"
    ;;

  get)
    print_cat_header "chartin course..."
    print_tree_start "🦺 $METER get"
    get_local_paths "$METER"
    get_global_paths "$METER"
    # fail loud upfront on any corrupt state file (top level → exit propagates)
    assert_meter_file_valid "$LOCAL_STATE_FILE"
    assert_meter_file_valid "$ORG_STATE_FILE"
    assert_meter_file_valid "$GLOBAL_STATE_FILE"
    # local envs
    if [[ -f "$LOCAL_STATE_FILE" ]]; then
      local_envs=$(jq -r 'to_entries | map("\(.key)=\(.value.uses)") | .[]' "$LOCAL_STATE_FILE")
      if [[ -n "$local_envs" ]]; then
        echo "   ├─ local:"
        while IFS= read -r entry; do
          echo "   │  └─ $entry"
        done <<< "$local_envs"
      else
        echo "   ├─ local: unset"
      fi
    else
      echo "   ├─ local: unset"
    fi
    # org (block-only: "allowed" means "not frozen", NOT "prod granted")
    org_states=$(read_all_org_states "$METER")
    if [[ "$org_states" == "unset" ]]; then
      echo "   ├─ org: unset"
    else
      echo "   ├─ org (freeze policy; never grants prod on its own):"
      mapfile -t org_lines <<< "$org_states"
      for org_idx in "${!org_lines[@]}"; do
        org_entry="${org_lines[$org_idx]}"
        org_name="${org_entry%%=*}"
        org_val="${org_entry#*=}"
        # last org gets └─, the rest ├─ (proper treestruct)
        if [[ $((org_idx + 1)) -eq ${#org_lines[@]} ]]; then branch="└─"; else branch="├─"; fi
        if [[ "$org_val" == "blocked" ]]; then
          echo "   │  $branch $org_name: frozen (hard stop)"
        else
          echo "   │  $branch $org_name: not frozen"
        fi
      done
    fi
    # global
    if [[ "$(read_global_blocked "$METER")" == "true" ]]; then
      echo "   └─ global: blocked"
    else
      echo "   └─ global: not blocked"
    fi
    ;;

  *)
    echo "error: unknown command: $COMMAND" >&2
    exit 2
    ;;
esac
