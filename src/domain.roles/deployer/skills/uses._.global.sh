#!/usr/bin/env bash
######################################################################
# .what = manage the global prod circuit-breaker for a *.uses meter
#
# .why  = humans can freeze a verb's prod access across ALL repos with
#         one switch — the highest-precedence blocker
#
# .how  = invoked by the uses._.sh dispatcher with --meter <name>.
#
# usage (via dispatcher):
#   <meter> block --global    # freeze this verb's prod everywhere
#   <meter> allow --global    # lift the global freeze
#   <meter> get   --global    # check global state
#
# guarantee:
#   - state stored at ~/.rhachet/storage/repo=ghlitch/role=deployer/.meter/<meter>.global.jsonc
#   - global block overrides local and org
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/uses._.output.sh"
source "$SCRIPT_DIR/uses._.operations.sh"

# parse args
METER=""
COMMAND=""

while [[ $# -gt 0 ]]; do
  case $1 in
    # crash-safe value read (see uses._.local.sh): a bare `--meter` won't crash
    # under `set -e`; it leaves METER empty for the absent-arg check below.
    --meter) METER="${2:-}"; shift; [[ $# -gt 0 && "$1" != --* ]] && shift || true ;;
    allow|block|get) COMMAND="$1"; shift ;;
    --global) shift ;;
    --help|-h)
      echo "usage: <meter> block --global"
      echo "       <meter> allow --global"
      echo "       <meter> get --global"
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
  echo "error: command required (allow, block, or get)" >&2
  exit 2
fi

# mutation commands require TTY (human only)
case "$COMMAND" in
  allow|block) require_human "$METER $COMMAND --global" ;;
esac

get_global_paths "$METER"

case "$COMMAND" in
  block)
    findsert_meter_dir "$GLOBAL_METER_DIR"
    echo '{ "blocked": true }' > "$GLOBAL_STATE_FILE"
    print_cat_header "anchors away!"
    print_tree_start "🦺 $METER block --global"
    echo "   └─ global: blocked (all repos)"
    ;;

  allow)
    findsert_meter_dir "$GLOBAL_METER_DIR"
    echo '{ "blocked": false }' > "$GLOBAL_STATE_FILE"
    print_cat_header "smooth sailin!"
    print_tree_start "🦺 $METER allow --global"
    echo "   └─ global: not blocked"
    ;;

  get)
    print_cat_header "chartin course..."
    print_tree_start "🦺 $METER get --global"
    assert_meter_file_valid "$GLOBAL_STATE_FILE"
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
