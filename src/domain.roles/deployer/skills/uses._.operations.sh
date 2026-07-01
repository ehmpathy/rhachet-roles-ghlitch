#!/usr/bin/env bash
######################################################################
# .what = shared engine for *.uses meters (deploy.uses, provision.uses)
#
# .why  = DRY the common logic — path lookup, env-keyed state reads,
#         the allow/block decision cascade, quota decrement, and the
#         TTY human guard — across local, global, and org handlers and
#         across both named meters.
#
# .how  = every function takes a $meter name (e.g. "deploy.uses") so one
#         code path serves both meters. local state is env-keyed so a
#         grant targets a specific --env (only prod is gated by callers).
#
# usage:
#   source "$SCRIPT_DIR/uses._.operations.sh"
#   decide_uses "deploy.uses" "prod"   # echoes a decision token
#
# storage:
#   global: ~/.rhachet/storage/repo=ghlitch/role=deployer/.meter/<meter>.global.jsonc
#   org:    ~/.rhachet/storage/repo=ghlitch/role=deployer/.meter/<meter>.org.jsonc
#   local:  <repo>/.meter/<meter>.jsonc   (env-keyed: { "prod": { "uses": N|"infinite" } })
######################################################################

# global storage paths (per role)
ROLE_REPO="ghlitch"
ROLE_SLUG="deployer"
GLOBAL_METER_DIR="$HOME/.rhachet/storage/repo=$ROLE_REPO/role=$ROLE_SLUG/.meter"

# derive global + org state file paths for a meter
# usage: get_global_paths "deploy.uses"
get_global_paths() {
  local meter="$1"
  GLOBAL_STATE_FILE="$GLOBAL_METER_DIR/$meter.global.jsonc"
  ORG_STATE_FILE="$GLOBAL_METER_DIR/$meter.org.jsonc"
}

# derive local state file path for a meter (requires git root)
# usage: get_local_paths "deploy.uses"
get_local_paths() {
  local meter="$1"
  REPO_ROOT=$(git rev-parse --show-toplevel)
  LOCAL_METER_DIR="$REPO_ROOT/.meter"
  LOCAL_STATE_FILE="$LOCAL_METER_DIR/$meter.jsonc"
}

# ensure we're in a git repo
require_git_repo() {
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "error: not in a git repository" >&2
    exit 2
  fi
}

# guard: mutation commands require TTY (human only)
# note: __I_AM_HUMAN=true allows integration tests to run mutations
require_human() {
  local command="$1"
  if [[ ! -t 0 && "${__I_AM_HUMAN:-}" != "true" ]]; then
    print_cat_header "belay that..."
    print_tree_start "🦺 $command"
    print_tree_error "only humans can run this command"
    exit 2
  fi
}

# findsert .meter directory with .gitignore
findsert_meter_dir() {
  local dir="$1"
  mkdir -p "$dir"
  if [[ ! -f "$dir/.gitignore" ]]; then
    echo "*" > "$dir/.gitignore"
  fi
}

# read org from .agent/keyrack.yml#org (fail-closed if absent)
# sets ORG_VALUE on success; sets ORG_ERROR + returns 2 on failure
get_org_from_keyrack() {
  ORG_ERROR=""
  ORG_VALUE=""
  local git_root
  git_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -z "$git_root" ]]; then
    ORG_ERROR="not in a git repository"
    return 2
  fi
  local keyrack_file="$git_root/.agent/keyrack.yml"
  if [[ ! -f "$keyrack_file" ]]; then
    ORG_ERROR=".agent/keyrack.yml not found"
    return 2
  fi
  local org_val
  org_val=$(grep -E "^org:" "$keyrack_file" 2>/dev/null | head -n1 | sed 's/^org:[[:space:]]*//' | tr -d '[:space:]')
  if [[ -z "$org_val" ]]; then
    ORG_ERROR=".agent/keyrack.yml#org required"
    return 2
  fi
  ORG_VALUE="$org_val"
  return 0
}

# fail loud if a PRESENT meter state file does not parse as json.
# absent file → no-op (a meter with no state is a valid, safe-default state).
# MUST be called at top level (not inside $()), so its exit 1 propagates — a
# corrupt gate file must never read as a silent default (e.g. a corrupt global
# freeze file silently read as "not blocked" would lift the freeze unseen).
# usage: assert_meter_file_valid "/path/to/<meter>.jsonc"
assert_meter_file_valid() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  if ! jq empty "$file" > /dev/null 2>&1; then
    print_cat_header "wet paws..." >&2
    print_tree_start "🦺 meter state" >&2
    echo "   └─ corrupt meter state file: $file" >&2
    exit 1
  fi
}

# read global blocked state (returns "true" or "false"). absent file → "false".
# corruption is caught upfront by assert_meter_file_valid, so jq here sees valid
# json; `.blocked // false` covers a valid file that omits the key.
# usage: read_global_blocked "deploy.uses"
read_global_blocked() {
  local meter="$1"
  get_global_paths "$meter"
  [[ -f "$GLOBAL_STATE_FILE" ]] || { echo "false"; return; }
  jq -r '.blocked // false' "$GLOBAL_STATE_FILE"
}

# read org state for a specific org (returns "allowed", "blocked", or "unset").
# falls back to @all when the specific org is unset. absent file → "unset".
# usage: read_org_state "deploy.uses" "ehmpathy"
read_org_state() {
  local meter="$1"
  local org="$2"
  get_global_paths "$meter"
  [[ -f "$ORG_STATE_FILE" ]] || { echo "unset"; return; }
  local org_val
  org_val=$(jq -r ".orgs[\"$org\"] // \"unset\"" "$ORG_STATE_FILE")
  if [[ "$org_val" != "unset" ]]; then
    echo "$org_val"
    return
  fi
  # specific org unset → fall back to @all
  jq -r '.orgs["@all"] // "unset"' "$ORG_STATE_FILE"
}

# read all org states (returns "unset" or newline list of org=state).
# absent file → "unset".
# usage: read_all_org_states "deploy.uses"
read_all_org_states() {
  local meter="$1"
  get_global_paths "$meter"
  [[ -f "$ORG_STATE_FILE" ]] || { echo "unset"; return; }
  local orgs
  orgs=$(jq -r '.orgs // {} | to_entries | map("\(.key)=\(.value)") | .[]' "$ORG_STATE_FILE")
  if [[ -n "$orgs" ]]; then
    echo "$orgs"
  else
    echo "unset"
  fi
}

# read local uses for an env (returns "<N>", "infinite", or "unset").
# absent file → "unset".
# usage: read_local_uses "deploy.uses" "prod"
read_local_uses() {
  local meter="$1"
  local env="$2"
  get_local_paths "$meter"
  [[ -f "$LOCAL_STATE_FILE" ]] || { echo "unset"; return; }
  jq -r --arg env "$env" '.[$env].uses // "unset"' "$LOCAL_STATE_FILE"
}

# write local uses for an env, preserving other envs
# usage: write_local_uses "deploy.uses" "prod" 1
#        write_local_uses "deploy.uses" "prod" infinite
write_local_uses() {
  local meter="$1"
  local env="$2"
  local uses="$3"
  get_local_paths "$meter"
  findsert_meter_dir "$LOCAL_METER_DIR"
  local base="{}"
  [[ -f "$LOCAL_STATE_FILE" ]] && base=$(cat "$LOCAL_STATE_FILE")
  # write atomically: jq → temp, then move. if jq fails on a corrupt base, the
  # temp write fails (set -e halts) and the live file stays intact.
  local tmp="$LOCAL_STATE_FILE.tmp"
  if [[ "$uses" == "infinite" ]]; then
    echo "$base" | jq --arg env "$env" '.[$env].uses = "infinite"' > "$tmp"
  else
    echo "$base" | jq --arg env "$env" --argjson v "$uses" '.[$env].uses = $v' > "$tmp"
  fi
  mv "$tmp" "$LOCAL_STATE_FILE"
}

# delete local uses for an env, preserving other envs
# usage: del_local_uses "deploy.uses" "prod"
del_local_uses() {
  local meter="$1"
  local env="$2"
  get_local_paths "$meter"
  [[ -f "$LOCAL_STATE_FILE" ]] || return 0
  local result
  result=$(jq --arg env "$env" 'del(.[$env])' "$LOCAL_STATE_FILE")
  echo "$result" > "$LOCAL_STATE_FILE"
}

# decide the prod-gate outcome for a meter + env
#
# ┌──────────────────────────────────────────────────────────────────────┐
# │ THE GRANT RULE: only a LOCAL allow can permit prod.                   │
# │                                                                       │
# │   - org `block`  → a HARD FREEZE. wins over a local allow.            │
# │   - org `allow`  → does NOT permit prod on its own. it ONLY lifts an  │
# │                    org block (e.g. overrides an `@all` freeze for one │
# │                    org). a repo still needs its OWN local allow to    │
# │                    actually go to prod.                               │
# │   - local allow  → the ONLY thing that grants prod (when not frozen). │
# │                                                                       │
# │ so org policy is block-only in effect: it can freeze, or clear a      │
# │ freeze, but it can never substitute for a repo's explicit local grant.│
# └──────────────────────────────────────────────────────────────────────┘
#
# precedence (highest to lowest):
#   1. global block  — total freeze, wins over all
#   2. org block     — hard freeze controlled by someone other than the actor;
#                      wins over a local allow (a local allow cannot bypass it)
#   3. local set     — the ONLY grant path: allow (quota/unlimited) or block
#   4. unset         — safe default: blocked
#                      (reached when there is no local grant — even if org=allow,
#                       because an org allow never grants on its own)
#
# echoes one of:
#   blocked:global         global circuit-breaker on
#   blocked:org            org policy blocks (hard freeze)
#   allowed:local:<N>      local quota grant (N uses left)
#   allowed:local:infinite local unlimited grant
#   blocked:local          local explicit revoke (uses=0)
#   blocked:unset          no local grant (safe default) — org allow does NOT grant
# usage: decide_uses "deploy.uses" "prod"
decide_uses() {
  local meter="$1"
  local env="$2"

  # 1. global blocker always wins
  if [[ "$(read_global_blocked "$meter")" == "true" ]]; then
    echo "blocked:global"
    return
  fi

  # derive org policy — but ONLY when an org state file exists. when org policy is
  # in play the caller (uses.check) has already verified the repo's org is
  # readable and the file parses, so this read is safe. when no org file exists,
  # org plays no part (and keyrack is not even needed).
  # note: org "allowed" is NOT used to grant below — it only means "org does not
  # freeze this repo", which lets the local decision (step 3) take effect.
  local org_state="unset"
  get_global_paths "$meter"
  if [[ -f "$ORG_STATE_FILE" ]] && get_org_from_keyrack; then
    org_state=$(read_org_state "$meter" "$ORG_VALUE")
  fi

  # 2. an org block is a hard freeze — it wins over any local grant
  if [[ "$org_state" == "blocked" ]]; then
    echo "blocked:org"
    return
  fi

  # 3. a LOCAL grant is the only path that permits prod (early returns, no else).
  #    org "allow" intentionally does NOT appear here — it cannot grant on its own.
  local local_uses
  local_uses=$(read_local_uses "$meter" "$env")

  # no local grant → blocked (safe default). even an org `allow` lands here: it
  # lifted any org freeze but did not, and cannot, grant prod by itself.
  [[ "$local_uses" == "unset" ]] && { echo "blocked:unset"; return; }

  # unlimited local grant
  [[ "$local_uses" == "infinite" ]] && { echo "allowed:local:infinite"; return; }

  # quota local grant (N > 0)
  [[ "$local_uses" -gt 0 ]] && { echo "allowed:local:$local_uses"; return; }

  # local explicit revoke (uses = 0)
  echo "blocked:local"
}
