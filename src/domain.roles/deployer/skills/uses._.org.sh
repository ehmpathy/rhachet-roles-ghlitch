#!/usr/bin/env bash
######################################################################
# .what = manage org-level prod policy for a *.uses meter
#
# .why  = humans can FREEZE prod for a whole org (or @all), or lift that
#         freeze for a specific org. org policy is block-only in effect.
#
# .important = org `allow` does NOT grant prod on its own. it only LIFTS
#         an org freeze (e.g. overrides an `@all` block for one org). a
#         repo still needs its OWN local grant (`<meter> allow/set --env
#         prod`) to actually go to prod. only a local grant permits prod.
#
# .how  = invoked by the uses._.sh dispatcher with --meter <name>.
#
# usage (via dispatcher):
#   <meter> block --org @all        # freeze prod for ALL orgs (hard stop)
#   <meter> block --org ehmpathy    # freeze prod for this org (hard stop)
#   <meter> allow --org ehmpathy    # lift this org's freeze (does NOT grant)
#   <meter> del   --org ehmpathy    # remove org config, defer to @all
#   <meter> get   --org             # show all org configs
#
# guarantee:
#   - state stored at ~/.rhachet/storage/repo=ghlitch/role=deployer/.meter/<meter>.org.jsonc
#   - specific org wins over @all
#   - org `block` is a hard freeze (wins over a local allow)
#   - org `allow` only lifts a freeze; a local grant is still required
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/uses._.output.sh"
source "$SCRIPT_DIR/uses._.operations.sh"

# parse args
METER=""
COMMAND=""
ORG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    # crash-safe value reads: shift past the flag, then shift past the value only
    # if one is present. an absent value (e.g. a bare `--org` at the end) leaves
    # the var empty for the downstream absent-arg check to report as a clean
    # exit 2, instead of a `set -e` crash on `shift 2`.
    --meter) METER="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    allow|block|del|get) COMMAND="$1"; shift ;;
    --org) ORG="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    # org policy is env-agnostic (a coarse per-org switch, like --global).
    # accept --env for grammar consistency with local, but ignore it.
    --env) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    --help|-h)
      echo "usage: <meter> allow --org <name|@all>"
      echo "       <meter> block --org <name|@all>"
      echo "       <meter> del --org <name>"
      echo "       <meter> get --org"
      exit 0
      ;;
    --repo|--role|--skill) shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
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

if [[ -z "$METER" ]]; then
  echo "error: --meter required (set by dispatcher)" >&2
  exit 2
fi
if [[ -z "$COMMAND" ]]; then
  echo "error: command required (allow, block, del, or get)" >&2
  exit 2
fi

# mutation commands require TTY (human only)
case "$COMMAND" in
  allow|block|del) require_human "$METER $COMMAND --org" ;;
esac

# mutations require --org
case "$COMMAND" in
  allow|block|del)
    if [[ -z "$ORG" ]]; then
      print_cat_header "belay that..."
      print_tree_start "🦺 $METER $COMMAND --org"
      print_tree_error "absent required arg: --org <name|@all>"
      exit 2
    fi
    ;;
esac

get_global_paths "$METER"

# write an org state into the org file, keep other orgs intact.
# atomic: jq → temp, then move. if jq fails on a corrupt base, the temp write
# fails (set -e halts) and the live org file stays intact (no partial clobber).
write_org_state() {
  local org="$1"
  local state="$2"
  findsert_meter_dir "$GLOBAL_METER_DIR"
  local base='{ "orgs": {} }'
  [[ -f "$ORG_STATE_FILE" ]] && base=$(cat "$ORG_STATE_FILE")
  local tmp="$ORG_STATE_FILE.tmp"
  echo "$base" | jq --arg org "$org" --arg state "$state" '.orgs[$org] = $state' > "$tmp"
  mv "$tmp" "$ORG_STATE_FILE"
}

case "$COMMAND" in
  allow)
    write_org_state "$ORG" "allowed"
    print_cat_header "smooth sailin!"
    print_tree_start "🦺 $METER allow --org $ORG"
    echo "   ├─ org $ORG: freeze lifted (not frozen)"
    echo "   └─ note: does NOT grant prod — a local grant is still required"
    ;;

  block)
    write_org_state "$ORG" "blocked"
    print_cat_header "anchors away!"
    print_tree_start "🦺 $METER block --org $ORG"
    echo "   └─ org $ORG: frozen (hard stop — local allow cannot bypass)"
    ;;

  del)
    if [[ -f "$ORG_STATE_FILE" ]]; then
      result=$(jq --arg org "$ORG" 'del(.orgs[$org])' "$ORG_STATE_FILE")
      echo "$result" > "$ORG_STATE_FILE"
    fi
    print_cat_header "anchors away!"
    print_tree_start "🦺 $METER del --org $ORG"
    echo "   └─ org $ORG config removed, defers to @all"
    ;;

  get)
    print_cat_header "chartin course..."
    print_tree_start "🦺 $METER get --org"
    assert_meter_file_valid "$ORG_STATE_FILE"
    org_states=$(read_all_org_states "$METER")
    if [[ "$org_states" == "unset" ]]; then
      echo "   └─ org: unset"
    else
      echo "   └─ org (freeze policy; never grants prod on its own):"
      mapfile -t org_lines <<< "$org_states"
      for org_idx in "${!org_lines[@]}"; do
        org_entry="${org_lines[$org_idx]}"
        org_name="${org_entry%%=*}"
        org_val="${org_entry#*=}"
        # last org gets └─, the rest ├─ (proper treestruct)
        if [[ $((org_idx + 1)) -eq ${#org_lines[@]} ]]; then branch="└─"; else branch="├─"; fi
        if [[ "$org_val" == "blocked" ]]; then
          echo "      $branch $org_name: frozen (hard stop)"
        else
          echo "      $branch $org_name: not frozen"
        fi
      done
    fi
    ;;

  *)
    echo "error: unknown command: $COMMAND" >&2
    exit 2
    ;;
esac
