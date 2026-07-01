#!/usr/bin/env bash
######################################################################
# 🦺 deploy.uses — gate prod deploys behind explicit human grants
#
# .what = the prod-gate meter for deploy-lifecycle skills (deploy, rollback)
#
# .why  = prod is sacred. by default no one deploys to prod from local.
#         a human grants access explicitly; quota grants auto-revoke.
#         independent of provision.uses — unlock one without the other.
#
# usage:
#   rhx deploy.uses get                              # check state
#   rhx deploy.uses set --quant 1 --env prod         # one-shot grant
#   rhx deploy.uses allow --env prod                 # unlimited grant
#   rhx deploy.uses block --env prod                 # revoke (local)
#   rhx deploy.uses del --env prod                   # defer to org/global
#   rhx deploy.uses block --global                   # freeze prod everywhere
#   rhx deploy.uses allow --org ehmpathy --env prod  # org policy
#   rhx deploy.uses help
#
# guarantee:
#   - thin wrapper over the shared *.uses engine (--meter deploy.uses)
#   - only humans may grant (TTY guard); exit 2 on constraint
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# help — scan all args (rhx passes --skill/--repo/--role first)
for arg in "$@"; do
  if [[ "$arg" == "help" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    echo "🐈 heres the deal..."
    echo ""
    echo "🦺 deploy.uses — prod gate for deploys (deploy, rollback)"
    echo ""
    echo "usage:"
    echo "  rhx deploy.uses get"
    echo "  rhx deploy.uses set --quant 1 --env prod"
    echo "  rhx deploy.uses allow --env prod"
    echo "  rhx deploy.uses block --env prod"
    echo "  rhx deploy.uses del --env prod"
    echo "  rhx deploy.uses block --global"
    echo "  rhx deploy.uses allow --org ehmpathy --env prod"
    echo ""
    echo "commands:"
    echo "  get    check state across local/org/global"
    echo "  set    grant N prod uses (one-shot, auto-revokes)"
    echo "  allow  grant unlimited prod access"
    echo "  block  revoke — sets a hard local lock (wins over org policy)"
    echo "  del    remove local config — defers to org/global (NOT a lock)"
    echo ""
    echo "note: block and del differ — block locks, del just clears local state."
    exit 0
  fi
done

exec bash "$SCRIPT_DIR/uses._.sh" --meter deploy.uses "$@"
