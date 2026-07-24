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
#   rhx provision.declastruct --wish <path> --env prod --mode apply --auth as-cicd
#   rhx provision.declastruct help
#
# options:
#   --wish WISH   path to a declastruct resources.ts (required)
#   --env ENV     environment: test, prep, or prod (required)
#   --mode MODE   operation mode: plan or apply (required)
#   --plan PLAN   plan file path (optional; defaults to <wish>.plan.json). plan mode
#                 writes it, apply mode reads it — declastruct's --wish/--plan backbone.
#                 an explicit value overrides the derived default.
#   --auth AUTH   prod-apply authorization source: as-cicd (optional). in CI, defers
#                 the prod-apply gate to the github-environment approval instead of
#                 the local human meter (requires CI=true). local runs omit it.
#   <extra args>  any arg the skill does not consume is forwarded verbatim to the
#                 declastruct invocation, so new declastruct flags propagate
#                 without a skill change
#   --            hard stop: the -- and every token after it are forwarded verbatim to
#                 declastruct (declastruct's cli wants a literal -- before wish-file
#                 passthrough flags), so `... --mode plan -- --wish-flag=v` reaches the
#                 wish file intact instead of matching this skill's own flags
#
# note: the declastruct plan/apply stdout is propagated unmodified, so a caller can
#       `| tee ./plan.log` and grep it (e.g. for the up-to-date marker to skip a
#       gated apply). the chosen --env is exported (STAGE/ACCESS) so the wish file
#       may reuse the given env or source its own env separately.
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
  echo "  --env    environment: test, prep, or prod (required). drives keyrack unlock and"
  echo "           is exported as STAGE/ACCESS so a wish file may reuse it; a wish file"
  echo "           that sources its own env still wins (the wish file decides)"
  echo "  --mode   operation: plan or apply (required)"
  echo "  --plan   plan file path (optional; defaults to <wish>.plan.json). plan writes"
  echo "           it, apply reads it — declastruct's --wish/--plan backbone"
  echo "  --auth   prod-apply auth: as-cicd (optional; CI-only — omit on local runs. in CI"
  echo "           it defers the prod-write gate to the github-environment approval)"
  echo "  <extra>  any unconsumed arg forwarded verbatim to declastruct (optional)"
  echo "  --       hard stop: -- and every token after it go verbatim to declastruct,"
  echo "           so wish-file passthrough flags reach the wish file intact (optional)"
  exit 0
}

# require a value for a flag — belay fast if the next token is absent (e.g. the flag
# was passed as the last arg). without this, set -u would trip a cryptic unbound-variable
# crash instead of a helpful message. one helper, used by every valued flag, so the
# absent-value message never drifts between flags.
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case)
  if [[ -z "$2" ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ provision.declastruct"
    echo "   ├─ absent value for $1"
    echo "   └─ hint: rhx provision.declastruct help"
    exit 2
  fi
}

# parse args. any arg not consumed here is collected into DECLASTRUCT_ARGS and forwarded
# to the declastruct invocation verbatim (e.g. a new declastruct flag), so the skill
# stays a thin wrapper. --env is always consumed by the skill (it drives keyrack) even
# though it is also exported for the wish file to reuse. every valued flag guards its
# value via require_val, so a flag passed with no value fails loud (not a set -u crash).
WISH=""
ENV=""
MODE=""
AUTH=""
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
      require_val --env "${2:-}"
      ENV="$2"
      shift 2
      ;;
    --mode)
      require_val --mode "${2:-}"
      MODE="$2"
      shift 2
      ;;
    --auth)
      # --auth is optional, but if given it MUST carry a value — an absent value would
      # slip past the optional-auth guard below and silently drop the caller's intent
      # to opt into cicd auth. require_val fails loud instead (the enum guard below then
      # rejects a present-but-wrong value).
      require_val --auth "${2:-}"
      AUTH="$2"
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
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
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

# validate --auth if supplied — only "as-cicd" is a recognized auth source. fail loud
# on a typo rather than silently ignore it (an ignored auth could look like it opted
# into the cicd auth when it did not).
if [[ -n "$AUTH" && "$AUTH" != "as-cicd" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ invalid auth: $AUTH"
  echo "   └─ must be: as-cicd"
  exit 2
fi

# prod gate: prod writes are gated; only plan stays open (it alone reads remote state).
# gate fail-closed — every mode but plan mutates prod (apply runs the reviewed plan), so
# gate all non-plan modes. a future write mode is gated by default rather than a silent
# bypass of this safety control. placed before keyrack + declastruct so a blocked write
# never touches prod. --auth passes through to uses.check: --auth as-cicd defers the
# prod-write gate to the ambient github-environment approval (CI) instead of the local
# human meter.
if [[ "$ENV" == "prod" && "$MODE" != "plan" ]]; then
  DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  GATE_ARGS=(--meter provision.uses --env prod)
  [[ -n "$AUTH" ]] && GATE_ARGS+=(--auth "$AUTH")
  bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" "${GATE_ARGS[@]}" || exit $?
fi

# the plan file defaults beside the wish, exactly as CI does (.declastruct.yml uses
# <wish-path>.plan.json), so the local skill and CI never drift on the plan location.
# an explicit --plan overrides this default when a caller wants a custom plan location
# (declastruct's own --wish/--plan backbone), while the default keeps the pit of success.
PLAN_FILE="${PLAN:-$WISH.plan.json}"

# apply requires a prior plan file so apply never ships an unreviewed diff (gitops
# safety; matches CI's plan-artifact handoff). belay pre-header, like every other
# validation belay (case2–case6), so the header tree is never left half-drawn — and a
# doomed apply never touches keyrack. see rule.require.treestruct-output.
if [[ "$MODE" == "apply" && ! -f "$PLAN_FILE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.declastruct"
  echo "   ├─ plan not found: $PLAN_FILE"
  echo "   └─ hint: run --mode plan first"
  exit 2
fi

# output header
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.declastruct --wish $WISH --env $ENV --mode $MODE"
echo "   ├─ wish: $WISH"
echo "   ├─ env: $ENV"
echo "   ├─ mode: $MODE"

# unlock keyrack so the wish file's keyrack.source() can hydrate credentials. skip
# entirely when aws creds are already set (CI/OIDC static creds) — never touch keyrack
# in CI, and never override OIDC creds. the guard is the ambient AWS_ACCESS_KEY_ID, so
# every mode skips keyrack in CI regardless of --auth.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "   ├─ unlock keyrack..."
  rhx keyrack unlock --owner ehmpath --env "$ENV"
fi

# export the chosen env so a wish file may reuse it (STAGE/ACCESS are the repo's
# env-name vars) instead of a hard-coded env. a wish file that names its own env still
# wins — this only offers the given env for reuse.
export STAGE="$ENV"
export ACCESS="$ENV"

# run declastruct with inherited fds — its stdout (incl. the up-to-date marker)
# propagates unmodified to the caller, so a workflow can `| tee ./plan.log` and grep it
# to decide whether a gated apply runs. forward DECLASTRUCT_ARGS verbatim.
# declastruct frames its own output with one blank line before and one after (like the
# schema tool provision.database wraps), so this skill adds no blank of its own around
# the call — a self-added blank would double the gap. matches provision.database's
# single-blank gap, not provision.terraform's frame-both-sides (terraform emits no blank
# of its own).
# plan mode: preview the diff and write the plan file. explicit-if (not an else
# arm) keeps the two modes as flat, independently-guarded paths (no else).
if [[ "$MODE" == "plan" ]]; then
  echo "   └─ plan infra changes..."
  npx declastruct plan --wish "$WISH" --into "$PLAN_FILE" ${DECLASTRUCT_ARGS[@]+"${DECLASTRUCT_ARGS[@]}"}
fi

# apply mode: apply the reviewed plan (the prior-plan-file guard already belayed
# pre-header above, so an absent plan never reaches here).
if [[ "$MODE" == "apply" ]]; then
  echo "   └─ apply reviewed plan..."
  npx declastruct apply --plan "$PLAN_FILE" ${DECLASTRUCT_ARGS[@]+"${DECLASTRUCT_ARGS[@]}"}
fi

echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.declastruct --wish $WISH --env $ENV --mode $MODE"
if [[ "$MODE" == "plan" ]]; then
  echo "   └─ planned → $PLAN_FILE"
fi
if [[ "$MODE" == "apply" ]]; then
  echo "   └─ provisioned"
fi
