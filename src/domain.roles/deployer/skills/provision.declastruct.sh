#!/usr/bin/env bash
######################################################################
# ⛵ provision.declastruct — provision infra via declastruct plan/apply
#
# .what = declaratively provision remote resources (aws, github) via
#         declastruct, with a plan/apply pattern
#
# .why  = enables infra provision with a plan/apply pattern:
#         - plan mode previews the diff and writes <wish>.plan.json
#         - apply mode applies the reviewed plan file
#         - conforms to provision.terraform / provision.database
#
# usage:
#   rhx provision.declastruct --wish <path> --env <env> --mode plan
#   rhx provision.declastruct --wish <path> --env <env> --mode apply
#   rhx provision.declastruct --wish <path> --env <env> --mode apply --auth via-ambient
#   rhx provision.declastruct --wish <path> --env prod --mode apply --gate for-cicd
#   rhx provision.declastruct help
#
# options:
#   --wish WISH   path to a declastruct resources.ts (required)
#   --env ENV     environment: test, prep, prod, or camp (required)
#   --mode MODE   operation mode: plan or apply (required)
#   --plan PLAN   plan file path (optional; defaults to <wish>.plan.json). plan mode
#                 writes it, apply mode reads it — declastruct's --wish/--plan backbone.
#                 an explicit value overrides the derived default.
#   --auth AUTH   IDENTITY — where credentials come from (default: via-keyrack)
#                   via-keyrack  unlock keyrack for --env and source it INTO this process
#                   via-ambient  use the session already in this shell; never touch keyrack
#                 the caller DECLARES this; it is never inferred from ambient state.
#   --gate GATE   APPROVAL — which caller-kind's gate clears a prod write (default: for-ehmpath)
#                   for-ehmpath  the quota a human granted the agent (the local meter)
#                   for-cicd     the github-environment approval (requires CI=true)
#                 only a prod write ever reads this; plan and non-prod runs never consult it.
#   <extra args>  any arg the skill does not consume is forwarded verbatim to the
#                 declastruct invocation, so new declastruct flags propagate
#                 without a skill change
#   --            hard stop: the -- and every token after it are forwarded verbatim to
#                 declastruct (declastruct's cli wants a literal -- before wish-file
#                 passthrough flags), so `... --mode plan -- --wish-flag=v` reaches the
#                 wish file intact instead of matching this skill's own flags
#
# note: the declastruct plan/apply output is FRAMED in a treestruct sub.bucket, not
#       propagated at column 0. declastruct renders its own tree, so it is a kin skill
#       to nest, never a raw payload to forward (see the bucket call far below).
#       a caller that needs declastruct's stdout to grep should invoke `npx declastruct`
#       directly, which is what .github/workflows/.declastruct.yml already does.
#       the chosen --env is exported (STAGE/ACCESS) so the wish file may reuse the
#       given env or source its own env separately.
#
# note: declastruct provisions ANY declared resource — aws, github, stripe, or whatever
#       sdk the wish file imports. this skill therefore SUPPORTS providers but REQUIRES
#       none: it never asserts a given provider's credential is present, and its errors
#       never presume which provider a run targets. see the deployer brief
#       rule.forbid.declastruct-provider-assumptions.
#
# guarantee:
#   - exit 0 = provision completed
#   - exit 1 = malfunction (declastruct/aws error)
#   - exit 2 = constraint (absent args, bad env, absent plan)
######################################################################
set -euo pipefail

# help — one definition, called from the arg-parse case so it works under rhx (which
# prepends --skill/--repo/--role before the user's args). single source, no drift.
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ provision.declastruct"
  echo ""
  echo "usage:"
  echo "  rhx provision.declastruct --wish <path> --env <env> --mode <mode>"
  echo ""
  echo "options:"
  echo "  --wish   path to a declastruct resources.ts (required)"
  echo "  --env    environment: test, prep, prod, or camp (required). drives keyrack and"
  echo "           is exported as STAGE/ACCESS so a wish file may reuse it; a wish file"
  echo "           that sources its own env still wins (the wish file decides)"
  echo "  --mode   operation: plan or apply (required)"
  echo "  --plan   plan file path (optional; defaults to <wish>.plan.json). plan writes"
  echo "           it, apply reads it — declastruct's --wish/--plan backbone"
  echo "  --auth   where credentials come from (default: via-keyrack)"
  echo "             via-keyrack  unlock keyrack for --env, source it into this process"
  echo "             via-ambient  use the session already in this shell; skip keyrack"
  echo "  --gate   whose gate clears a PROD write (default: for-ehmpath)"
  echo "             for-ehmpath  the quota a human granted the agent (local meter)"
  echo "             for-cicd     the github-environment approval (requires CI=true)"
  echo "  <extra>  any unconsumed arg forwarded verbatim to declastruct (optional)"
  echo "  --       hard stop: -- and every token after it go verbatim to declastruct,"
  echo "           so wish-file passthrough flags reach the wish file intact (optional)"
  echo ""
  echo "example:"
  echo "  rhx provision.declastruct --wish ./resources.ts --env camp --mode plan"
  exit 0
}

# require a value for a flag — belay fast when the next token cannot serve as the value.
# one helper, used by every valued flag, so the message never drifts between flags.
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--wish --env prep` would otherwise set WISH='--env' and eat the
#      next flag whole. the run then belays about `--env` as absent, which points the
#      caller at the wrong flag entirely: a wrong-but-specific hint, which costs more than
#      a right-but-general one (rule.forbid.surprises). no valued flag here takes a value
#      that legitimately starts with `--` (paths, enums, slugs), so the test is safe.
# a flag with a CLOSED value set passes that set as $3, and the belay names it. an error
# that rejects a value without a note of the valid ones is a blocker under
# rule.require.errors-name-the-fix, and it is the difference between one more keystroke and
# a trip to `help`. it is optional rather than mandatory because --wish and --plan take a
# free-form path, where no set exists to name and a fabricated one would mislead.
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ provision.declastruct"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx provision.declastruct help"
    exit 2
  fi
}

# .what = list the credential variable NAMES a keyrack `source` block exported
# .why  = the identity block reports exactly what keyrack put in this process, so it must
#         read the names back off the export statements themselves rather than guess at a
#         provider's variable list (rule.forbid.declastruct-provider-assumptions).
# .note = `sed '/^$/d'` drops the blank last line, the same guard the kin mapfile calls
#         carry (aws.cloudwatch.logs.query.sh:413,433).
get_all_cred_vars_from_keyrack_exports() {
  # $1 = the raw `rhx keyrack source` stdout — a block of `export NAME='value'` lines
  printf '%s\n' "$1" \
    | sed -n 's/^export \([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' \
    | sed '/^$/d' \
    | sort
}

# .what = list the credential variable NAMES this shell already holds
# .why  = under --auth via-ambient the caller declared THIS shell as the source, so the
#         shell is what gets read. the match is on credential NOUNS
#         (_TOKEN/_KEY/_KEY_ID/_SECRET/_PROFILE/_CREDENTIALS) rather than a provider list,
#         so a provider we have never heard of still shows up.
# .note = `_KEY_ID` earns its own alternative because `AWS_ACCESS_KEY_ID` ends in `_ID`,
#         NOT `_KEY` — so a `_KEY$` match alone drops the single most standard aws static
#         credential, and a shell that held the usual triple would report only two of the
#         three. a PARTIAL identity report is the failure this skill exists to retire, and
#         it would bite hardest in the highest-stakes case (a CI prod apply on OIDC creds).
#         a bare `_ID$` is deliberately NOT used — it would sweep in USER_ID, SESSION_ID,
#         and every kin non-credential; `KEY_ID` names a credential noun and stays
#         provider-blind (rule.forbid.declastruct-provider-assumptions).
# .note = it over-reports on a desktop, and a LIVE run on one is the measure of how much.
#         a real `--auth via-ambient` plan on a cosmic/ptyxis/starship desktop rendered
#         exactly three leaves — DCONF_PROFILE, PTYXIS_PROFILE, STARSHIP_SESSION_KEY — and
#         NOT one credential. so two things are true and both matter:
#           1. the signal stays findable, because output is sorted and every aws/github
#              noun sorts above the desktop ones (AWS_* and GITHUB_* precede DCONF_*).
#              a real AWS_PROFILE lands at the TOP of the nest, which is the fact the
#              2026-08-05 misdiagnosis lacked
#           2. the EMPTY render is effectively unreachable on a desktop. `(none detected)`
#              is the honest report for a shell with no credential, and a desktop shell
#              will almost always show noise instead. do NOT rely on an empty block to
#              signal "no ambient credentials" — the belay-free ambient path is declared
#              to proceed regardless, and declastruct's own provider error is the backstop
#         no tighter NAME rule can fix this: STARSHIP_SESSION_KEY is a true `_KEY$` and
#         API_KEY is a real credential, so any rule that drops one drops the other. a fix
#         needs a signal other than the name, which is a design fork rather than a typo —
#         recorded as fulcrum F6. a stray or a miss never blocks a run: this REPORTS, it
#         never gates.
# .note = exit status is MEANINGFUL and the caller must read it: `set -o pipefail` makes
#         grep's status the pipeline's, and grep has three — 0 matched, 1 NO MATCH (the
#         legitimate zero-credential shell), 2 a REAL error (bad regex, read failure).
#         1 and 2 must never collapse into each other: a broken scan that rendered as
#         "(none detected)" would report "this shell holds no credentials" when the truth
#         is "the scan broke" — on the one skill whose whole job is to report the identity
#         honestly (rule.forbid.failhide-in-shell). see the read below.
get_all_cred_vars_from_shell() {
  compgen -v \
    | grep -E '_(TOKEN|KEY|KEY_ID|SECRET|PROFILE|CREDENTIALS)$' \
    | sed '/^$/d' \
    | sort
}

# .what = render the identity block's leaves, one per credential variable name
# .why  = the report is presentation, and it sits under the `identity` branch of a header
#         tree the orchestrator prints. kept as its own step so the header section reads as
#         a narrative rather than a render loop inlined mid-tree
#         (rule.prefer.decomposable-architecture).
# .note = index-walk so the LAST child closes the nest with └─ — a sub-bucket that never
#         terminates reads as truncated output (rule.require.treestruct-output). `branch` is
#         the repo's own word for a tree item: rule.require.nest-subskill-output-in-buckets
#         calls `├─` a "branch item", and uses._.output.sh:30 calls the final `└─` the
#         "last leaf".
# .note = callers must not invoke this with an empty list; the `(none detected)` leaf is the
#         caller's branch, which also keeps an empty array off the argument list.
print_identity_leaves() {
  # $@ = the credential variable NAMES, already sorted
  local CRED_INDEX=1
  local CRED_VAR CRED_BRANCH
  for CRED_VAR in "$@"; do
    CRED_BRANCH="├─"
    [[ $CRED_INDEX -eq $# ]] && CRED_BRANCH="└─"

    # a *_PROFILE value is a NAME, not a secret — show it, since "which profile" is
    # exactly the fact the 2026-08-05 misdiagnosis lacked. all else shows (set) only.
    if [[ "$CRED_VAR" == *_PROFILE ]]; then
      echo "   │  $CRED_BRANCH $CRED_VAR = ${!CRED_VAR}"
    else
      echo "   │  $CRED_BRANCH $CRED_VAR = (set)"
    fi

    CRED_INDEX=$((CRED_INDEX + 1))
  done
}

# parse args. any arg not consumed here is collected into DECLASTRUCT_ARGS and forwarded
# to the declastruct invocation verbatim (e.g. a new declastruct flag), so the skill
# stays a thin wrapper. --env is always consumed by the skill (it drives keyrack) even
# though it is also exported for the wish file to reuse. every valued flag guards its
# value via require_val, so a flag passed with no value fails loud (not a set -u crash).
# the two credential/approval axes carry DEFAULTS, not empty sentinels: an unset --auth
# means via-keyrack (the common local case), and an unset --gate means for-ehmpath (the
# quota a human granted the agent). defaults live here, at the declaration, so the enum
# guards below validate exactly one value space and no downstream branch has to re-ask
# "was it supplied?" — the caller's choice and the default are the same shape.
WISH=""
ENV=""
MODE=""
AUTH="via-keyrack"
GATE="for-ehmpath"
PLAN=""
DECLASTRUCT_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --wish)
      require_val --wish "${2:-}"
      WISH="$2"
      shift 2
      ;;
    --env)
      require_val --env "${2:-}" "test, prep, prod, camp"
      ENV="$2"
      shift 2
      ;;
    --mode)
      require_val --mode "${2:-}" "plan, apply"
      MODE="$2"
      shift 2
      ;;
    --auth)
      # --auth is optional (it defaults), but if given it MUST carry a value — an absent
      # value would silently fall back to the default and discard the caller's declared
      # intent. that is the exact class of defect this flag exists to remove, so
      # require_val fails loud instead (the enum guard below then rejects a
      # present-but-wrong value).
      require_val --auth "${2:-}" "via-keyrack, via-ambient"
      AUTH="$2"
      shift 2
      ;;
    --gate)
      # --gate is optional (it defaults), and carries the same require_val guard as
      # --auth for the same reason: a silent fall back to for-ehmpath would discard a
      # caller's opt into the cicd gate, which is a prod-write authorization decision.
      #
      # it names its valid set for the same reason its kin `provision.database` does: one
      # flag, one contract, one message across both skills
      # (rule.require.consistent-skill-contracts).
      require_val --gate "${2:-}" "for-ehmpath, for-cicd"
      GATE="$2"
      shift 2
      ;;
    --plan)
      # --plan is declastruct's other backbone input (alongside --wish): the plan file
      # path. optional here — it overrides the derived <wish>.plan.json default. the
      # skill consumes it and maps it to declastruct's --into (plan) / --plan (apply),
      # so a caller controls the plan location without the default's collision risk.
      require_val --plan "${2:-}"
      PLAN="$2"
      shift 2
      ;;
    --skill|--role|--repo)
      # rhachet propagates these; ignore
      shift 2
      ;;
    --)
      # -- is a hard stop. declastruct's own cli requires a literal -- before any
      # wish-file passthrough flags, so re-emit the -- and drain every residual token
      # verbatim into DECLASTRUCT_ARGS. without this, the -- was dropped and later tokens
      # still matched this skill's flags (e.g. `-- --env x` overrode $ENV), which broke
      # the documented verbatim-forward contract.
      shift
      DECLASTRUCT_ARGS+=(--)
      while [[ $# -gt 0 ]]; do
        DECLASTRUCT_ARGS+=("$1")
        shift
      done
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      # forward any unconsumed arg to declastruct
      DECLASTRUCT_ARGS+=("$1")
      shift
      ;;
  esac
done

# validate required args
if [[ -z "$WISH" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ absent required arg: --wish"
  echo "   └─ hint: rhx provision.declastruct --wish <path> --env <env> --mode plan"
  exit 2
fi

if [[ ! -f "$WISH" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ wish not found: $WISH"
  echo "   └─ hint: pass a path to a declastruct resources.ts"
  exit 2
fi

if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, prod, or camp"
  exit 2
fi

# camp is a first-class env here, not an afterthought: keyrack lists it alongside the
# others (rhx keyrack source --help → prod, prep, test, all, sudo, camp), and an operator
# who runs --env camp must reach the credential path rather than belay before it.
if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" && "$ENV" != "camp" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, prod, or camp"
  exit 2
fi

if [[ -z "$MODE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ absent required arg: --mode"
  echo "   └─ must be: plan or apply"
  exit 2
fi

if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid mode: $MODE"
  echo "   └─ must be: plan or apply"
  exit 2
fi

# --auth as-cicd is RETIRED. it fused two questions into one word: which identity to run
# under, and who authorizes a prod write. those are separate axes now, so the old value
# cannot be mapped onto exactly one of them. give it its own belay that names the precise
# replacement — a caller who meets it learns the new words in one read, which is the
# whole point of a hardcut over an alias (rule.require.consistent-skill-contracts).
# checked BEFORE the enum guard so the retired value never falls into the generic
# "invalid auth" message, which would name the valid set but not the migration.
if [[ "$AUTH" == "as-cicd" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ retired flag value: --auth as-cicd"
  echo "   ├─ fix: replace it with --auth via-ambient --gate for-cicd"
  echo "   └─ why: identity and prod-write approval are separate axes"
  exit 2
fi

# validate --auth — the credential CHANNEL. fail loud on a typo rather than silently
# ignore it: an ignored --auth would fall back to via-keyrack and could overwrite the
# very session the caller meant to keep, which is the silent identity downgrade this
# skill exists to prevent.
if [[ "$AUTH" != "via-keyrack" && "$AUTH" != "via-ambient" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid auth: $AUTH"
  echo "   └─ must be: via-keyrack or via-ambient"
  exit 2
fi

# validate --gate — which caller-kind's approval clears a prod write. fail loud for the
# same reason as --auth, with higher stakes: a silently-ignored gate value decides
# whether a prod mutation is authorized at all.
if [[ "$GATE" != "for-ehmpath" && "$GATE" != "for-cicd" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid gate: $GATE"
  echo "   └─ must be: for-ehmpath or for-cicd"
  exit 2
fi

# prod gate: prod writes are gated; only plan stays open (it alone reads remote state).
# gate fail-closed — every mode but plan mutates prod (apply runs the reviewed plan), so
# gate all non-plan modes. a future write mode is gated by default rather than a silent
# bypass of this safety control. placed before the credential work below so a blocked
# write never unlocks a keyrack, let alone touches prod.
#
# --gate forwards VERBATIM to uses.check: no translation at this boundary, because the
# gate skill speaks the same word (rule.require.consistent-skill-contracts). a
# caller-faced term that had to be re-spelled internally would be the same one-concept-
# two-words defect, one layer down.
# the plan file defaults beside the wish, exactly as CI does (.declastruct.yml uses
# <wish-path>.plan.json), so the local skill and CI never drift on the plan location.
# an explicit --plan overrides this default when a caller wants a custom plan location
# (declastruct's own --wish/--plan backbone), while the default keeps the pit of success.
PLAN_FILE="${PLAN:-$WISH.plan.json}"

# ── nest ────────────────────────────────────────────────────────────────────────────
# sourced ONCE, unconditionally, because this skill frames TWO children: the prod gate
# below and the declastruct run at the end. it used to be sourced inside the gate branch
# alone, which is why the declastruct run had no frame available to it.
#
# reach the nest helper PACKAGE-relatively, via BASH_SOURCE — never through
# `git rev-parse --show-toplevel`, which resolves to the CONSUMER's repo root and so
# only works in a repo that happens to hold this src tree.
DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SKILL_DIR="$(cd "$DEPLOYER_SKILL_DIR/../../operator/skills" && pwd)"
source "$OPERATOR_SKILL_DIR/_.nest.sh"

# ── header ──────────────────────────────────────────────────────────────────────────
# printed BEFORE the gate, so the gate's output has a parent tree to nest under as a
# treestruct sub.bucket (rule.require.nest-subskill-output-in-buckets).
#
# only the `identity` block further below depends on the credential work; every field
# here is known from parsed args alone. those two facts were bundled into one header
# for a long while, which made the gate look un-bucketable — it is not. the header is
# a sequence of independent lines, so it splits at the credential boundary: what the
# caller ASKED FOR renders now, what actually LANDED renders after the credentials do.
#
# every belay that resolves from parsed args alone is hoisted ABOVE this line, so it
# keeps its own mascot and its own ⛵ block. a belay must never inherit the success
# mascot, and a belay on stderr must never depend on a tree that went to stdout.
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.declastruct --wish $WISH --env $ENV --mode $MODE"
echo "   ├─ wish: $WISH"
echo "   ├─ env: $ENV"
echo "   ├─ mode: $MODE"
echo "   ├─ auth: $AUTH"

if [[ "$ENV" == "prod" && "$MODE" != "plan" ]]; then
  echo "   ├─ check the gate..."
  # _or_belay, not `|| exit $?`: a blocked gate must close THIS tree and state the
  # verdict at column 0, never exit mid-frame and leave the ⛵ tree half-drawn.
  run_sub_bucket_or_belay "   │  " "⛵ provision.declastruct" "blocked at the gate" \
    bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" \
    --meter provision.uses --env prod --gate "$GATE"
fi

# apply requires a prior plan file so apply never ships an unreviewed diff (gitops
# safety; matches CI's plan-artifact handoff). it sits AFTER the gate on purpose — a
# prod write that is not authorized must be refused on that ground, never on a plan
# file it was never entitled to reach.
#
# a SELF-CONTAINED belay: its own mascot, its own ⛵ block, seamed off the header tree
# above. it cannot inherit the header's `chartin course...` mascot — a belay that opens
# with the success vibe reads as a run that started fine.
#
# it CLOSES the header tree first. the tree's `└─` is the `plan infra changes...` /
# `apply reviewed plan...` line far below, so a belay that skips it leaves the ⛵ tree
# half-drawn — items under no close, the same defect `run_sub_bucket_or_belay` exists to
# prevent at the gate. the close names the OUTCOME, with `blocked:` for a constraint and
# `halted:` for a malfunction, so the render states the exit class the code carries.
if [[ "$MODE" == "apply" && ! -f "$PLAN_FILE" ]]; then
  echo "   └─ blocked: absent plan file"
  echo ""
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ plan not found: $PLAN_FILE"
  echo "   └─ hint: run --mode plan first"
  exit 2
fi

# ── credentials ─────────────────────────────────────────────────────────────────────
# the ONLY place credentials are decided, and the caller DECLARED which way via --auth.
# no line here sniffs ambient state to infer intent: the prior code guarded on whether
# AWS_ACCESS_KEY_ID happened to be set, which MISSED a human's selected admin session
# (that sets AWS_PROFILE, not AWS_ACCESS_KEY_ID) and silently overwrote their identity.
#
# this section runs AFTER the header's asked-for half (`wish`/`env`/`mode`/`auth`) and
# BEFORE its landed half (`identity`), because only the identity depends on the outcome
# here. the two costs that order carries are each paid explicitly:
#
#   1. a belay taken here lands mid-tree, so it must CLOSE the tree on its way out. the
#      absent-credentials belay does (`└─ blocked: absent credentials`), and the unlock
#      failure does via run_sub_bucket_or_belay. neither may exit with items left under
#      no close.
#   2. `rhx keyrack unlock` prints its OWN 🔓 tree, so un-framed it interleaves into ours
#      mid-branch. it is therefore bucketed, exactly as the prod gate is
#      (rule.require.nest-subskill-output-in-buckets).
#
# an earlier revision of this comment claimed the section ran BEFORE the header and so
# could never leave a half-drawn tree. that stopped being true when the header split, and
# the claim outlived the code: a `keyrack unlock` timeout rendered a 🔓 wall at column 0
# inside our tree and exited with the tree still open. read the render, not the comment
# (rule.require.trust-but-verify).

# via-keyrack: unlock, then SOURCE the keys into THIS process. `rhx keyrack unlock` alone
# runs in a subprocess whose exports die with it, so the parent kept whatever credential
# it already had and the sdk fell through to a fallback profile — the defect that cost an
# operator a two-hour misdiagnosis. the eval is what makes the unlock actually land here.
#
# extracted as a named step so the section below reads as a narrative — declare, supply,
# report — rather than inline raw i/o (rule.prefer.decomposable-architecture). it must be
# a FUNCTION and not a subshell or a `$(...)`: the whole point is that the exports land in
# THIS process, and a subshell's would die exactly the way `keyrack unlock`'s already do.
# it sets the global KEYRACK_EXPORTS, which the identity report reads afterward.
set_creds_via_keyrack() {
  # $1 = env
  #
  # bucketed, because keyrack renders its own 🔓 tree. un-framed it lands at column 0 in
  # the middle of THIS skill's header — a second wall of tree inside ours, which is the
  # shape rule.require.nest-subskill-output-in-buckets exists to retire.
  #
  # _or_belay, not `|| exit $?`: an unlock that fails (an expired sso session, a timed-out
  # browser prompt) must CLOSE this skill's tree and state the verdict at column 0. under
  # a bare call, set -e exited mid-frame and left the ⛵ tree open — items under no close,
  # with keyrack's own error the last thing on screen and no word from this skill at all.
  echo "   ├─ unlock the keyrack..."
  run_sub_bucket_or_belay "   │  " "⛵ provision.declastruct" "blocked at the keyrack" \
    rhx keyrack unlock --owner ehmpath --env "$1"

  # capture before eval so we can (a) count what arrived and (b) clear rivals first.
  # --lenient makes an env with no keys a silent no-op rather than an error, which is
  # why the count below is the real guard.
  #
  # `source` (the WHOLE keyrack for this env), never `get --key AWS_PROFILE`. a request for
  # a NAMED aws key IS a provider assumption, and this skill provisions any declared
  # resource — a github- or stripe-only wish would fetch a profile it never needs and fail
  # when keyrack holds none (rule.forbid.declastruct-provider-assumptions). the 13 aws-only
  # kin skills use `get --key` honestly; that split is required, not a defect to reconcile.
  # `source` is the repo's extant whole-rack verb, already used by jest.integration.env.ts:41,
  # jest.acceptance.env.ts:46, and the wish files themselves — this is its first shell caller.
  KEYRACK_EXPORTS="$(rhx keyrack source --owner ehmpath --env "$1" --lenient)"

  # aws SUPPORTED, never REQUIRED. this clears ambient aws static keys ONLY when keyrack
  # actually supplied an aws profile — a github-only wish never reaches it. it NARROWS
  # (removes a rival credential that would contradict the caller's declaration); it never
  # asserts an aws credential must exist. see rule.forbid.declastruct-provider-assumptions.
  # why it is needed: --lenient means a keyrack miss is silent, so a leftover static key
  # could satisfy the run under an identity the caller never declared. the aws sdk also
  # warns that a future version may flip its profile-over-static-keys precedence, so a
  # design that leans on today's order is a time bomb.
  #
  # this unsets the OPPOSITE side from 11 kin skills, which `unset AWS_PROFILE
  # AWS_DEFAULT_PROFILE` (deploy.sh:135, provision.terraform.sh:240, use.vpc.tunnel.sh:193,
  # and 8 more). that is a mirror, not a break: they DERIVE static keys from a profile via
  # `aws configure export-credentials`, so the profile becomes the rival; keyrack hands us
  # a profile directly and we derive no static keys, so an ambient static key is the rival.
  # one principle, two ends — leave exactly ONE credential channel alive. do not "align"
  # this line with the kin; that would restore the rival it exists to remove.
  #
  # ORDER MATTERS: unset BEFORE eval. the vision's timeline wrote it the other way
  # ("eval → unset"), and that sequence carries a latent defect — an env whose keyrack holds
  # STATIC keys would have them evaled in and then unset right back out, so the run would
  # lose the very credential keyrack supplied and fall back to the profile alone. clear the
  # ambient rival first, then eval, and whatever keyrack holds survives intact either way.
  # do not "restore" the vision's literal order; this deviation is deliberate.
  if [[ "$KEYRACK_EXPORTS" == *"AWS_PROFILE"* ]]; then
    unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  fi

  eval "$KEYRACK_EXPORTS"

  # assert the DECLARATION held — zero keys means via-keyrack cannot be honored. this is
  # the one credential assert, and it keys on the declared SOURCE rather than on any
  # provider's variables, so it is true for an aws, github, or stripe wish alike.
  # a SELF-CONTAINED belay: its own mascot, its own ⛵ block. this cannot be an in-tree
  # belay, because the header's tree went to STDOUT and this goes to STDERR — an
  # in-tree shape would leave a caller who reads only stderr with orphan leaves and no
  # tree above them. the blank ahead of the mascot seams it off the header tree when
  # both streams land on one tty.
  #
  # the tree CLOSE goes to stdout, because that is the stream the tree itself lives on.
  # only the belay below is stderr-bound. a close written to stderr would hang off no
  # tree for a stdout reader, and leave the stdout tree open forever.
  if [[ -z "${KEYRACK_EXPORTS//[[:space:]]/}" ]]; then
    echo "   └─ blocked: absent credentials"
    echo "" >&2
    echo "🐈 belay that..." >&2
    echo "" >&2
    echo "⛵ provision.declastruct" >&2
    echo "   ├─ absent credentials: keyrack holds no keys for env=$1" >&2
    echo "   ├─ fix: fill them — rhx keyrack fill --owner ehmpath" >&2
    echo "   └─ or: declare this shell's own session with --auth via-ambient" >&2
    exit 2
  fi
}

# the declared source decides, and this is the whole of the decision. one line per channel.
if [[ "$AUTH" == "via-keyrack" ]]; then
  set_creds_via_keyrack "$ENV"
fi

# via-ambient: touch naught. the caller declared that this shell already holds the right
# credentials, and that DECLARATION IS THE ASSERTION — to second-guess it would re-import
# the ambient sniff, merely inverted. the absence of a presence check here is also the
# only provider-agnostic choice: a check for aws variables would belay a github-only wish
# over a credential it never needed. an empty shell simply renders an empty identity
# block below, so the gap is visible before the handoff.

# the header's asked-for half is already on screen (printed above the gate, so the gate
# could nest under it). what follows is the landed half: the identity block, which can
# only be stated once the credential work above has run.

# report which credentials are in play. this REPORTS, it never INTERPRETS — it does not
# claim any of these is the one the wish needs, because only the wish knows that.
#
# the DECLARED SOURCE decides the list, which is the same principle the assert above
# follows — ask the source, never the provider:
#   via-keyrack  exactly the names keyrack exported. precise, so a rich desktop shell
#                cannot bury the one line that matters under unrelated noise.
#   via-ambient  the shell's own — the caller declared this shell, so the shell is the
#                source. see get_all_cred_vars_from_shell for how it is read and why.
# collected via mapfile -t, the repo's extant idiom for lines-into-an-array (kin use at
# aws.cloudwatch.logs.query.sh:413,433 and aws.cloudwatch.metrics.query.sh:249,265).
echo "   ├─ identity"
CRED_VARS=()

if [[ "$AUTH" == "via-keyrack" ]]; then
  mapfile -t CRED_VARS < <(get_all_cred_vars_from_keyrack_exports "$KEYRACK_EXPORTS")
fi

# the ambient scan is read in TWO steps, on purpose. `mapfile < <(…)` never evaluates the
# process substitution's exit status, so a one-step read cannot tell grep's exit 1 (NO
# MATCH — a legitimately credential-less shell) from its exit 2 (a REAL error). both would
# render as `(none detected)`, i.e. "this shell holds no credentials" when the truth is
# "the scan broke" — the failhide this whole skill exists to retire, one layer down
# (rule.forbid.failhide-in-shell).
#
# so: capture into a variable first (a command substitution DOES surface the status),
# branch on it, and only then split into the array. `|| CRED_SCAN_STATUS=$?` catches the
# status without a `|| true`, which would flatten 1 and 2 back together.
if [[ "$AUTH" == "via-ambient" ]]; then
  CRED_SCAN_STATUS=0
  CRED_SCAN_OUT="$(get_all_cred_vars_from_shell)" || CRED_SCAN_STATUS=$?

  # exit >1 is grep's own error signal, never an empty result. fail loud rather than
  # report a shell we did not actually manage to read.
  # a SELF-CONTAINED wet-paws block, for the same reason as the belay above: this goes
  # to STDERR while the header tree went to STDOUT, so it carries its own mascot and
  # artifact header rather than hang leaves off a tree the stderr reader never saw.
  #
  # `├─ identity` is already on screen by this point, so the close has TWO jobs: fill
  # that branch (an open branch with no leaf is the empty-bucket sin, one level down) and
  # close the tree. `halted:` rather than `blocked:` — this is a malfunction (exit 1),
  # not a caller constraint.
  if [[ $CRED_SCAN_STATUS -gt 1 ]]; then
    echo "   │  └─ (unreadable)"
    echo "   └─ halted: credential scan failed"
    echo "" >&2
    echo "🐈 wet paws..." >&2
    echo "" >&2
    echo "⛵ provision.declastruct" >&2
    echo "   ├─ credential scan failed (exit $CRED_SCAN_STATUS)" >&2
    echo "   └─ the identity block cannot be trusted, so the run halts here" >&2
    exit 1
  fi

  # exit 1 means no match — a real, legitimate state that renders as `(none detected)`.
  # guard the split so an empty capture yields an EMPTY array rather than one blank entry.
  if [[ -n "$CRED_SCAN_OUT" ]]; then
    mapfile -t CRED_VARS <<<"$CRED_SCAN_OUT"
  fi
fi

# an empty list still closes its nest — `(none detected)` is a real report (the caller
# declared a source that yielded naught), never a silent gap. the branch stays at the call
# site rather than inside the renderer so an EMPTY array is never expanded as an argument:
# `"${arr[@]}"` on an empty array is safe only on bash 4.4+, and this skill must not carry a
# hidden version floor for a case the caller can trivially route around.
if [[ ${#CRED_VARS[@]} -eq 0 ]]; then
  echo "   │  └─ (none detected)"
else
  print_identity_leaves "${CRED_VARS[@]}"
fi

# export the chosen env so a wish file may reuse it (STAGE/ACCESS are the repo's
# env-name vars) instead of a hard-coded env. a wish file that names its own env still
# wins — this only offers the given env for reuse.
export STAGE="$ENV"
export ACCESS="$ENV"

# run declastruct inside a treestruct sub.bucket. declastruct is NOT a raw payload — it
# draws its own treestruct with its own mascots (🌊 / 🔮 / 🥥), so un-framed it stacks a
# second wall of headers at column 0 beside this skill's own. that is exactly the shape
# rule.require.nest-subskill-output-in-buckets exists to retire, and the rule's payload
# exemption does not reach it: the exemption is for output a CALLER PARSES (a data blob,
# a schema diff), not for a kin tool that renders a tree.
#
# this call carried a forward-contract exemption on the claim that a workflow would
# `| tee ./plan.log` this skill's stdout and grep it. no caller does. .declastruct.yml
# pipes `npx declastruct` DIRECTLY and never invokes this skill, so the contract the
# exemption rested on was never real — and an un-verified claim is not a contract
# (rule.require.trust-but-verify).
#
# `|| exit $?` is mandatory: run_sub_bucket runs the child in a pipe, so a bare call
# would not trip set -e and a failed provision would read as a success.
#
# .note = the bucket reads the child as 2>&1, so declastruct's stderr now arrives on THIS
#         skill's stdout. that stream shift is a real contract change, clamped explicitly
#         in the suite rather than left to whichever stream a test happens to read.
#
# plan mode: preview the diff and write the plan file. explicit-if (not an else
# arm) keeps the two modes as flat, independently-guarded paths (no else).
if [[ "$MODE" == "plan" ]]; then
  echo "   └─ plan infra changes..."
  run_sub_bucket "      " \
    npx declastruct plan --wish "$WISH" --into "$PLAN_FILE" ${DECLASTRUCT_ARGS[@]+"${DECLASTRUCT_ARGS[@]}"} || exit $?
fi

# apply mode: apply the reviewed plan (the prior-plan-file guard already belayed
# pre-header above, so an absent plan never reaches here).
if [[ "$MODE" == "apply" ]]; then
  echo "   └─ apply reviewed plan..."
  run_sub_bucket "      " \
    npx declastruct apply --plan "$PLAN_FILE" ${DECLASTRUCT_ARGS[@]+"${DECLASTRUCT_ARGS[@]}"} || exit $?
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.declastruct --wish $WISH --env $ENV --mode $MODE"
if [[ "$MODE" == "plan" ]]; then
  echo "   └─ planned → $PLAN_FILE"
fi
if [[ "$MODE" == "apply" ]]; then
  echo "   └─ provisioned"
fi
