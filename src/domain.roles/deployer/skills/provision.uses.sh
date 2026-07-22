#!/usr/bin/env bash
######################################################################
# 🦺 provision.uses — gate prod provisions behind explicit human grants
#
# .what = the prod-gate meter for provision skills (terraform, database)
#
# .why  = prod is sacred. by default no one applies to prod from local.
#         a human grants access explicitly; quota grants auto-revoke.
#         independent of deploy.uses — unlock one without the other.
#         note: only prod writes are gated; reads (plan) stay open.
#
# usage:
#   rhx provision.uses get                              # check state
#   rhx provision.uses set --quant 1 --env prod          # one-shot grant
#   rhx provision.uses allow --env prod                  # unlimited grant
#   rhx provision.uses block --env prod                  # revoke (local)
#   rhx provision.uses del --env prod                    # defer to org/global
#   rhx provision.uses block --global                    # freeze prod everywhere
#   rhx provision.uses allow --org ehmpathy --env prod   # org policy
#   rhx provision.uses help
#
# guarantee:
#   - thin wrapper over the shared *.uses engine (--meter provision.uses)
#   - only humans may grant (TTY guard); exit 2 on constraint
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# help — scan all args (rhx passes --skill/--repo/--role first)
for arg in "$@"; do
  if [[ "$arg" == "help" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    echo "🐈 heres the deal..."
    echo ""
    echo "🦺 provision.uses — prod gate for provisions (terraform, database)"
    echo ""
    echo "usage:"
    echo "  rhx provision.uses get"
    echo "  rhx provision.uses set --quant 1 --env prod"
    echo "  rhx provision.uses allow --env prod"
    echo "  rhx provision.uses block --env prod"
    echo "  rhx provision.uses del --env prod"
    echo "  rhx provision.uses block --global"
    echo "  rhx provision.uses allow --org ehmpathy --env prod"
    echo ""
    echo "commands:"
    echo "  get    check state across local/org/global"
    echo "  set    grant N prod uses (one-shot, auto-revokes)"
    echo "  allow  grant unlimited prod access"
    echo "  block  revoke — sets a hard local lock (wins over org policy)"
    echo "  del    remove local config — defers to org/global (NOT a lock)"
    echo ""
    echo "note: block and del differ — block locks, del just clears local state."
    echo "note: only prod writes are gated; reads ('plan') stay open."
    exit 0
  fi
done

exec bash "$SCRIPT_DIR/uses._.sh" --meter provision.uses "$@"
