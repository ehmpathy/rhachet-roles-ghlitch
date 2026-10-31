#!/usr/bin/env bash
######################################################################
# .what = ghlitch-cat vibes output for security.habitat.redteam
#
# .why  = consistent 🧿 two-header output for the ward-loop scaffold
#
# usage:
#   source output.sh
#   print_cat_header "chartin course..."
#   print_tree_start "security.habitat.redteam init"
#   print_tree_branch "route" ".behavior/v2026_09_07.guardian-redteam/ ✨"
######################################################################

# print cat mascot + phrase
print_cat_header() {
  local phrase="$1"
  echo "🐈 $phrase"
  echo ""
}

# print artifact tree root (🧿 = guardian)
print_tree_start() {
  local command="$1"
  echo "🧿 $command"
}

# print tree branch (has children)
print_tree_branch() {
  local key="$1"
  local value="$2"
  local is_last="${3:-false}"
  if [[ "$is_last" == "true" ]]; then
    echo "   └─ $key: $value"
  else
    echo "   ├─ $key: $value"
  fi
}

# print simple tree item (label only)
print_tree_item() {
  local label="$1"
  local is_last="${2:-false}"
  if [[ "$is_last" == "true" ]]; then
    echo "   └─ $label"
  else
    echo "   ├─ $label"
  fi
}

# print a belay/halt block. the severity picks BOTH the mascot and the close-word, keyed
# to the exit code the caller will use — "constraint" (exit 2 → 🐈 belay that / blocked:)
# or "malfunction" (exit 1 → 🐈 wet paws / halted:). this is the shared close-line
# vocabulary (rule.require.consistent-skill-contracts): a non-zero-exit tree closes on a
# word that mirrors the code, so a reader knows at a glance whether to fix their input or
# to retry.
print_belay() {
  local message="$1"
  local command="${2:-security.habitat.redteam}"
  local severity="${3:-constraint}"
  if [[ "$severity" == "malfunction" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🧿 $command"
    echo "   └─ halted: $message"
  else
    echo "🐈 belay that..."
    echo ""
    echo "🧿 $command"
    echo "   └─ blocked: $message"
  fi
}

# transformer: flatten a multi-line string onto one space-joined line, so a captured
# multi-line command output reads as a single tree-item label. behind a name so the
# orchestrators stay narrative (rule.forbid.inline-decode-friction).
as_oneline() {
  local text="$1"
  printf '%s' "${text//$'\n'/ }"
}

# the ONE source of the valid grains, so the enum cannot drift across the many
# sites that reference it — the same single-source discipline already applied to
# extract_redteam_route_path ("so both files cannot drift apart"). both the main
# skill and init.sh source this file, so both read the enum from here.
GRAIN_LIST=(infil exfil leak)

# the ONE source of the route-kind token. the slug BUILDER (as_route_slug), the bound-route
# MATCHER (extract_redteam_route_path), and init.sh's "already bound" belay all interpolate
# this, so the three can never drift apart. a divergence between builder and matcher is a
# SILENT-breakage hazard: get_bound_route would stop recognizing a bound route, so apply
# treats a bound branch as unbound and a second route clobbers the first's in-flight .claims/.
# the same single-source discipline GRAIN_LIST + is_positive_integer already apply here.
ROUTE_KIND="guardian-redteam"

# transformer: the comma-joined valid-grain hint (the closed set, plus "all").
# one call site per hint/fix line, fed by GRAIN_LIST so a hint can never drift
# from the membership check.
as_grain_hint() {
  local IFS=,
  printf '%s' "${GRAIN_LIST[*]},all"
}

# guard: is a grain value one of GRAIN_LIST (or "all")? return 0 valid, 1 invalid.
# the ONE membership check, consumed by every enum site (main skill + init.sh).
is_valid_grain() {
  local candidate="$1" valid
  for valid in "${GRAIN_LIST[@]}" all; do
    [[ "$candidate" == "$valid" ]] && return 0
  done
  return 1
}

# guard: is a value a positive integer (no zero prefix)? return 0 valid, 1 invalid.
# the ONE positive-integer check, so the regex has a single source rather than four
# inline copies across the two orchestrators — both --peers and --budget, in the main
# skill and init.sh, read as narrative ("reject an invalid peers value") instead of a
# bare `[[ "$x" =~ ^[1-9][0-9]*$ ]]` a reader must decode (rule.forbid.inline-decode-friction).
is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

# guard: does a captured git failure message name the not-a-repo case? return 0 when the
# message is git's "not a git repository" text (a constraint the caller fixes — run from a
# repo), 1 for any other git failure (a real malfunction). behind a name so the init
# orchestrator classifies the probe failure without an inline regex decode
# (rule.forbid.inline-decode-friction), and so the pattern has ONE source.
is_not_a_git_repo_error() {
  printf '%s' "$1" | grep -qi "not a git repository"
}

# transformer: a filesystem-safe route token for a sweep's scope, so two sweeps of
# DIFFERENT surfaces on the same day get distinct routes rather than collide on a
# date+grain slug (which would force the operator to destroy the first sweep's
# in-flight .claims/ to start the second). the whole-repo sweep ("." ) needs no
# token — it keeps the common slug clean; a subtree sweep slugifies its path.
# canonicalize a --scope value so the same surface has ONE form: collapse a
# ./ prefix, drop one end slash, map ./ and "" to the repo-root token "." — so
# `--scope .` and `--scope ./` (and `--scope src/` vs `src`) are idempotently identical
# for both the route slug token and the reuse match-assert.
as_normalized_scope() {
  local scope="$1"
  scope="${scope#./}"
  scope="${scope%/}"
  [[ -z "$scope" ]] && scope="."
  printf '%s' "$scope"
}

as_route_scope_token() {
  local scope="$1"
  [[ "$scope" == "." ]] && { printf '%s' ""; return; }
  # drop a prefix ./, encode the path separator DISTINCTLY (/ -> __) before the generic
  # collapse, so two different surfaces cannot alias to one token — `src/foo` and
  # `src-foo` must not both slugify to `src-foo`. then collapse each leftover
  # non-alnum/dot/underscore run to one dash, trim edge dashes.
  local token="${scope#./}"
  token="${token//\//__}"
  token="$(printf '%s' "$token" | tr -c '[:alnum:]._' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//')"
  printf '%s' ".scope=$token"
}

# the route slug for a sweep: v<today>.guardian-redteam.grain=<grain>[.scope=<token>].
# folds today's date, the grain, and a subtree scope token into ONE name, so two
# legitimate same-day sweeps (two grains, or two subtrees) land distinct routes rather
# than collide on a date-only name (which would force the operator to destroy the first
# sweep's in-flight .claims/ to start the second). the scope token stays space-free so
# extract_redteam_route_path's `guardian-redteam[^ ]*` match still finds the route. it
# stamps today's date, so the caller reads "compute the route slug" as prose.
as_route_slug() {
  local grain="$1" scope="$2"
  printf 'v%s.%s.grain=%s%s' \
    "$(date +%Y_%m_%d)" "$ROUTE_KIND" "$grain" "$(as_route_scope_token "$scope")"
}

# print the not-security-advice disclaimer (every guidance output carries it)
print_disclaimer() {
  echo ""
  echo "   ⚠️ informational only — NOT professional security advice. analyses are"
  echo "      not exhaustive; consult a qualified security professional for any"
  echo "      assessment of your own habitat."
}

# the ONE place the redteam route-path pattern lives, so both the main skill
# and init.sh read as narrative and cannot drift apart.
# transformer: read text on stdin, emit the first guardian-redteam route path
# (or empty when the text holds none).
extract_redteam_route_path() {
  # capture the whole match set into a var first (never `grep | head`, which can SIGPIPE
  # grep and muddy its exit). grep: 0 = matched, 1 = no match (benign — "no route"),
  # >=2 = a REAL error (I/O, bad pattern). a `|| true` would fold that real error into the
  # identical benign "no route" verdict — the silent-swallow class the kin get_bound_route
  # is hardened against — so surface rc>=2 as a malfunction (return 1), never as "no route".
  local matched rc=0
  # capture via a compound list (`|| rc=$?`) so `set -e` does not abort on grep's benign
  # rc=1 (no match) before the classify runs — a bare `matched=$(grep)` assignment under
  # set -e would abort the caller on any non-zero, which defeats the rc>=2 malfunction check.
  matched="$(grep -o "\.behavior/[^ ]*${ROUTE_KIND}[^ ]*")" || rc=$?
  if (( rc >= 2 )); then
    echo "extract_redteam_route_path: grep malfunctioned (rc=$rc)" >&2
    return 1
  fi
  printf '%s\n' "$matched" | head -1
}

# transformer: a DETERMINISTIC backstop for the promote stone's fullsun-safe gate.
# reads a drafted radio-task body on stdin and emits every live-claim marker it finds
# (one per line, kind-prefixed), or no lines when the body looks already-generalized.
#
# .why = the dispatch tool is itself an exfil channel (the wish's sharpest irony). the
#   fullsun-safe gate decides whether a lesson may leave upstream, and a pure-judgment
#   gate has no floor — an agent that mis-judges dispatches a live claim with no net
#   beneath it. this is the floor: a cheap grep heuristic for the specifics a fullsun-safe
#   CLASS must never carry (a path, a host, an ip, a key-shaped run, an account id). it is
#   a BACKSTOP, never the whole gate — a clean scan does not PROVE fullsun-safe (an agent
#   must still strip semantic specifics a regex cannot see), but a DIRTY scan proves a body
#   is NOT fullsun-safe and must not leave. the promote stone runs this on each drafted body
#   before dispatch and treats any hit as "keep in .claims/, do not dispatch".
scan_for_live_claim_markers() {
  # grep: 0 = markers found (dirty), 1 = none (clean), >=2 = a REAL scan error. a bare
  # `|| true` would fold a scanner malfunction into the empty "clean" result — and since the
  # promote gate reads "no lines = safe to dispatch", a tool break would become PERMISSION to
  # send a body upstream unscanned. the dispatch tool is an exfil channel, so this scanner
  # must fail toward DIRTY, never toward clean: on rc>=2 emit a synthetic marker line AND
  # return 1, so the gate reads a malfunction as "NOT fullsun-safe, do not dispatch".
  local hits rc=0
  # capture via a compound list (`|| rc=$?`) so `set -e` does not abort on grep's benign
  # rc=1 (no marker found = clean) before the classify runs.
  hits="$(grep -noE \
    -e '[0-9]{1,3}(\.[0-9]{1,3}){3}' \
    -e '(src|infra|provision|lib|bin|test|node_modules)/[A-Za-z0-9._/-]+' \
    -e '[A-Za-z0-9._-]+\.(tf|ts|sh|js|py|yml|yaml|json)(:[0-9]+)?' \
    -e '\b[0-9a-fA-F]{32,}\b' \
    -e '\b[A-Za-z0-9+/]{40,}={0,2}\b' \
    -e 'arn:[a-z0-9:._/-]+' \
    -e '\b[0-9]{12}\b')" || rc=$?
  if (( rc >= 2 )); then
    echo "SCANNER-MALFUNCTION:grep-rc=${rc} — treat as NOT fullsun-safe, do not dispatch"
    return 1
  fi
  [[ -n "$hits" ]] && printf '%s\n' "$hits"
  return 0
}

# communicator: probe the route the platform has bound.
# stdout = the bound guardian-redteam route path, or empty when no route is bound.
# return 1 (with a surfaced cause) ONLY when the probe itself malfunctions — a
# genuine tool break is never quietly turned into a "no route bound" verdict.
#
# .risk = this probe recognizes ONLY a guardian-redteam route path; a branch already
#   bound to some OTHER behavior's route is invisible here. if `rhx route.bind.set`
#   enforces one bound route per branch, init's scaffold-and-bind could clobber that
#   unrelated bind. this is not fixable within this skill without confirming
#   route.bind.*'s multiplicity semantics — so the hazard is documented here, and a
#   --skip-route-bind escape hatch lets an operator scaffold without the bind when a
#   branch already holds an in-flight bind they must not disturb.
get_bound_route() {
  local probed
  if ! probed="$(rhx route.bind.get 2>&1)"; then
    echo "route.bind.get probe failed: $probed" >&2
    return 1
  fi
  printf '%s\n' "$probed" | extract_redteam_route_path
}

# communicator: read the current git branch (a display label for the vibes).
# stdout = the branch name; on a git failure, "unknown (<cause>)" — the real cause is
# surfaced, never swallowed behind a bare "unknown". the same failloud shape its sibling
# communicator get_bound_route uses: capture stderr with 2>&1 rather than discard it with
# 2>/dev/null, so a maintainer can tell a genuine odd state (detached HEAD) from a git
# break (rule.forbid.failhide / rule.forbid.maintenance-hazards).
get_current_branch() {
  local branch
  if branch="$(git rev-parse --abbrev-ref HEAD 2>&1)"; then
    printf '%s' "$branch"
    return 0
  fi
  printf '%s' "unknown ($(as_oneline "$branch"))"
}

# communicator: write the sweep-parameters record a brain reads to walk the route.
# peers + budget are persisted HERE (never dropped) — the ground stone reads `peers`
# to size its partition, and the promote stone reads `budget` as the loop's spend
# allowance. a value validated by the parent skill but not recorded is a silent no-op.
set_scope_record() {
  local route="$1" scope="$2" grain="$3" peers="$4" budget="$5"
  cat > "$route/0.scope.md" <<EOF
# 0.scope — the sweep parameters

- scope: $scope
- grain: $grain
- peers: $peers
- budget: $budget

the ward loop reads this habitat through three grains:
- infil  — inbound channels (ways IN)
- exfil  — outbound channels (ways OUT, every exit)
- leak   — exposed values (already OUT)

- peers  — blind peers per grain-partition (the ground stone sizes its slices by this)
- budget — the loop's spend allowance (the promote stone draws it down per cycle)

claims live in \`.claims/\` (gitignored). live claims never publish — the
dispatch tool is itself an exfil channel. only FULLSUN-SAFE lessons (a
generalized class, never a live claim) leave via the promote stone.
EOF
}

# communicator: bind the route to the current branch.
# stdout = "bound to branch <b>" on success, or "NOT bound: <cause> — retry: ..."
# on failure; return 1 on failure so the caller can set its exit code honestly.
set_route_bind() {
  local route="$1" branch="$2"
  local bind_out
  if bind_out="$(rhx route.bind.set --route "$route" 2>&1)"; then
    printf '%s' "bound to branch $branch"
    return 0
  fi
  printf '%s' "NOT bound: $(as_oneline "$bind_out") — retry: rhx route.bind.set --route $route"
  return 1
}

# communicator: shell out to the route-scaffold boundary (init.sh), capture its
# combined output, and propagate its exit code. the one raw sub-process boundary in
# the apply flow, named so the orchestrator reads as "scaffold the route, check the
# result" rather than the mechanics of the shell-out — the same extraction its
# siblings get_bound_route / set_route_bind already have
# (rule.prefer.decomposable-architecture: an orchestrator composes named communicators,
# never raw i/o).
scaffold_route() {
  local init_sh="$1"
  shift
  bash "$init_sh" "$@" 2>&1
}

# transformer: the total blind-peer count across every grain-partition.
# the first link of the peers → total → projected arithmetic chain; behind a name
# so the whole pipeline has ONE source, not two inline formulas a later change
# could update inconsistently (rule.require.named-transformers).
compute_peer_total() {
  local peers="$1" grains="$2"
  printf '%s' "$(( peers * grains ))"
}

# transformer: the projected upper-bound spend of a sweep (deterministic).
# peer-total × budget-cycles = the worst-case peer-dispatch count. the next link
# after compute_peer_total, so the chain reads peers → total → projected.
compute_projected_cost() {
  local peer_total="$1" budget="$2"
  printf '%s' "$(( peer_total * budget ))"
}

# print the scaffolded stone list, DERIVED from the route dir so the render can
# never drift from what actually landed (the wish's "state at read time" hazard).
print_route_stones() {
  local route="$1" prefix="${2:-      }"
  local -a stones=()
  local file base
  for file in "$route"/*.stone; do
    [[ -f "$file" ]] || continue
    base="$(basename "$file" .stone)"
    if [[ -f "$route/$base.guard" ]]; then
      stones+=("$base.stone / .guard")
    else
      stones+=("$base.stone")
    fi
  done
  local i last=$(( ${#stones[@]} - 1 ))
  for i in "${!stones[@]}"; do
    if [[ "$i" -eq "$last" ]]; then
      echo "${prefix}└─ ${stones[$i]}"
    else
      echo "${prefix}├─ ${stones[$i]}"
    fi
  done
}

# communicator: confirm a bound route is actually driveable on disk — its dir exists AND
# holds at least one .stone. get_bound_route returns a persisted bind STRING that can
# outlive the route dir (a deleted dir, a changed checkout), so a clean "drive it" handoff
# over an absent route would promise a drive with no route to walk (rule.forbid.failhide).
# return 0 when driveable, 1 when the dir or its stones are absent.
is_route_on_disk() {
  local route="$1"
  [[ -d "$route" ]] || return 1
  local stones=("$route"/*.stone)
  [[ -e "${stones[0]}" ]]
}

# communicator: read one "- <field>: <value>" line from a route's 0.scope.md.
# stdout = the value; return 1 when the file or the field is absent.
get_route_scope_field() {
  local route="$1" field="$2"
  local scope_file="$route/0.scope.md"
  [[ -f "$scope_file" ]] || return 1
  local line
  line="$(grep -m1 "^- ${field}: " "$scope_file")" || return 1
  printf '%s' "${line#- ${field}: }"
}

# orchestrator: assert a bound route was scaffolded for THIS request — scope, grain,
# AND the loop parameters (peers, budget). scope+grain guard against a silent drive of
# the WRONG surface; peers+budget guard against a subtler drift — the plan this run
# printed (projected cost from the REQUEST's peers/budget) diverging from what the loop
# actually runs on (the BOUND route's 0.scope.md). both are wrong-sweep hazards the
# operator never sees (rule.forbid.friction-hazards). prints a belay and EXITS on a
# mismatch (exit 2 = constraint) or an unreadable scope record (exit 1 = malfunction);
# returns 0 on a clean match across all four fields.
assert_bound_route_matches_request() {
  local route="$1" want_scope="$2" want_grain="$3" want_peers="$4" want_budget="$5"
  local have_scope have_grain have_peers have_budget
  if ! have_scope="$(get_route_scope_field "$route" scope)" \
     || ! have_grain="$(get_route_scope_field "$route" grain)" \
     || ! have_peers="$(get_route_scope_field "$route" peers)" \
     || ! have_budget="$(get_route_scope_field "$route" budget)"; then
    print_belay "could not read the bound route's scope record: $route/0.scope.md" \
      "security.habitat.redteam --mode apply" "malfunction"
    exit 1
  fi
  if [[ "$have_scope" != "$want_scope" || "$have_grain" != "$want_grain" \
     || "$have_peers" != "$want_peers" || "$have_budget" != "$want_budget" ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🧿 security.habitat.redteam --mode apply"
    echo "   ├─ the bound route was scaffolded for a different sweep:"
    echo "   │  ├─ bound:     scope=$have_scope grain=$have_grain peers=$have_peers budget=$have_budget"
    echo "   │  └─ requested: scope=$want_scope grain=$want_grain peers=$want_peers budget=$want_budget"
    echo "   ├─ fix: re-run with the bound route's parameters, OR unbind"
    echo "   │       (rhx route.bind.del) and init a fresh route for this request"
    echo "   └─ blocked: requested sweep does not match the bound route"
    exit 2
  fi
  return 0
}

# communicator: copy every .stone + .guard template into the route dir.
# stdout = the count copied, so the caller can failfast on an empty (broken) install.
copy_route_templates() {
  local templates_dir="$1" route_path="$2"
  local copied=0 file
  for file in "$templates_dir"/*.stone "$templates_dir"/*.guard; do
    [[ -f "$file" ]] || continue
    cp -f "$file" "$route_path/"
    copied=$(( copied + 1 ))
  done
  printf '%s' "$copied"
}

# the ONE source of the route's required stones — each stone needs a paired .guard.
# a single source so a completeness check cannot drift from the set the ward loop
# actually walks (ground → detect → verify → repair → promote).
REQUIRED_ROUTE_STONES=(1.ground 2.detect 3.verify 4.repair 5.promote)

# transformer: list the required route files ABSENT from a scaffolded route dir,
# one per line (empty output = a complete scaffold). a PARTIAL copy — a bad glob, an
# unreadable or absent template, a damaged install that drops some-but-not-all files —
# leaves a gap here. the caller halts loud on a gap rather than hand a driver a route
# that lacks a stone/guard, which would fail the drive partway for an invisible reason
# (a hidden-state hazard: a broken install reported as a clean scaffold).
get_route_absent_files() {
  local route="$1" stone
  for stone in "${REQUIRED_ROUTE_STONES[@]}"; do
    [[ -f "$route/$stone.stone" ]] || printf '%s\n' "$stone.stone"
    [[ -f "$route/$stone.guard" ]] || printf '%s\n' "$stone.guard"
  done
}

# print one per-peer prompt line per active grain. the prompt text for each
# grain lives HERE (one place), so emit_plan reads as narrative not a case-table.
print_grain_prompts() {
  local g
  for g in "$@"; do
    case "$g" in
      infil) echo "      ├─ infil — \"what reaches IN to this slice, from where, with what power?\"" ;;
      exfil) echo "      ├─ exfil — \"by what channel could data leave this slice — net, DNS, log, webhook?\"" ;;
      leak)  echo "      ├─ leak  — \"what value on this slice is already exposed, or forms a map with others?\"" ;;
    esac
  done
}

# print each non-empty line of stdin under a gutter prefix (a nested bucket body).
# $1 = the gutter prefix (e.g. "   │  ").
print_nested_lines() {
  local prefix="$1"
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    echo "${prefix}${line}"
  done
}
