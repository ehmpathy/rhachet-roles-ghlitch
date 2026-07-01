#!/usr/bin/env bash
######################################################################
# .what = ghlitch cat vibes output for *.uses skills
#
# .why  = consistent, fun output format across all uses commands
#         (deploy.uses, provision.uses) and their scope handlers
#
# usage:
#   source uses._.output.sh
#   print_cat_header "smooth sailin!"
#   print_tree_start "🦺 deploy.uses set"
#   print_tree_error "prod is locked"
######################################################################

# print cat emoji + vibe phrase
# usage: print_cat_header "smooth sailin!"
print_cat_header() {
  local phrase="$1"
  echo "🐈 $phrase"
  echo ""
}

# print tree root (artifact + command)
# usage: print_tree_start "🦺 deploy.uses set"
print_tree_start() {
  local command="$1"
  echo "$command"
}

# print error in tree format (last leaf)
# usage: print_tree_error "prod is locked: no grant"
print_tree_error() {
  local message="$1"
  echo "   └─ $message"
}

# print instruction block (after tree)
# usage: print_instruction "ask your human to grant:" "  \$ rhx deploy.uses set --quant 1 --env prod"
print_instruction() {
  local header="$1"
  local command="$2"
  echo ""
  echo "$header"
  echo "$command"
}

# print tip in dim/muted style
# usage: print_tip "'rhx deploy.uses block --env prod' re-locks"
print_tip() {
  local text="$1"
  # \033[2m = dim, \033[0m = reset
  echo -e "   └─ \033[2mtip: $text\033[0m"
}
