#!/usr/bin/env bash
######################################################################
# .what = shared dispatcher for *.uses meters (deploy.uses, provision.uses)
#
# .why  = one engine, two named meters. the public wrappers
#         (deploy.uses.sh / provision.uses.sh) call this with --meter.
#         this routes to the right scope handler by flag.
#
# .how  = precedence of scope flags: --global > --org > local
#
# usage (via wrappers):
#   uses._.sh --meter deploy.uses set --quant 1 --env prod
#   uses._.sh --meter deploy.uses get
#   uses._.sh --meter deploy.uses block --global
#   uses._.sh --meter deploy.uses allow --org ehmpathy --env prod
#
# guarantee:
#   - --meter required (which meter to operate on)
#   - dispatches to uses._.local.sh / uses._.global.sh / uses._.org.sh
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GLOBAL_MODE=false
ORG_MODE=false
ARGS=()

# pull --meter out, detect scope flags, pass the rest through
i=0
all=("$@")
while [[ $i -lt ${#all[@]} ]]; do
  arg="${all[$i]}"
  case "$arg" in
    --meter)
      ARGS+=("--meter" "${all[$((i+1))]}")
      i=$((i+2))
      continue
      ;;
    --global) GLOBAL_MODE=true; ARGS+=("$arg") ;;
    --org) ORG_MODE=true; ARGS+=("$arg") ;;
    *) ARGS+=("$arg") ;;
  esac
  i=$((i+1))
done

# dispatch by scope precedence: global > org > local
if [[ "$GLOBAL_MODE" == "true" ]]; then
  exec bash "$SCRIPT_DIR/uses._.global.sh" "${ARGS[@]}"
elif [[ "$ORG_MODE" == "true" ]]; then
  exec bash "$SCRIPT_DIR/uses._.org.sh" "${ARGS[@]}"
else
  exec bash "$SCRIPT_DIR/uses._.local.sh" "${ARGS[@]}"
fi
