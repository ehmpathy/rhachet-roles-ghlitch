#!/usr/bin/env bash
######################################################################
# 🔮 aws.s3.list — list s3 bucket contents
#
# .what = list s3 bucket objects by prefix
#
# .why  = enables quick access to s3 data for debug:
#         - verify CloudFront logs landed
#         - browse bucket contents
#
# usage:
#   rhx aws.s3.list --env prod                                # list buckets
#   rhx aws.s3.list --env prod --uri s3://bucket/prefix/      # list objects
#   rhx aws.s3.list --env prod --bucket mybucket              # list objects
#   rhx aws.s3.list help
#
# options:
#   --env ENV       environment for aws credentials: test, prep, prod (required)
#   --uri URI       s3://bucket/prefix format
#   --bucket NAME   s3 bucket name
#   --prefix PATH   filter objects by prefix
#   --since TIME    only show objects modified within time (1h, 1d, 7d)
#   --limit N       max results (default: 50)
#
# guarantee:
#   - exit 0 = query completed
#   - exit 1 = malfunction (aws error)
#   - exit 2 = constraint (absent args)
######################################################################
set -euo pipefail

# parse args
BUCKET=""
PREFIX=""
SINCE=""
LIMIT=50
ENV=""
URI=""

# the help text used to indent `usage:` and `options:` to 3 spaces, under the artifact
# header — lines that are neither blank, nor a mascot, nor a header, nor a tree item, and a
# dialect no kin skill speaks. every other ghlitch skill sets these sections at column 0
# (rule.require.consistent-skill-contracts).
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.s3.list"
  echo ""
  echo "usage:"
  echo "  rhx aws.s3.list --env <env>"
  echo "  rhx aws.s3.list --env <env> --uri s3://bucket/prefix/"
  echo "  rhx aws.s3.list --env <env> --bucket <name>"
  echo ""
  echo "options:"
  echo "  --env       environment: test, prep, or prod"
  echo "  --uri       s3://bucket/prefix format"
  echo "  --bucket    s3 bucket name"
  echo "  --prefix    filter objects by prefix"
  echo "  --since     filter by recency (30m, 1h, 7d)"
  echo "  --limit     max results (default: 50)"
  echo "  --help      show this help"
  echo ""
  echo "examples:"
  echo "  rhx aws.s3.list --env prep"
  echo "  rhx aws.s3.list --env prep --uri s3://ahbode-logs/2026/ --since 1h"
  exit 0
}

# every belay in this skill used to be a ONE-LINER — `🐈 belay that... --env required` on a
# single line, with no blank, no artifact header, and no tree. one of them then followed
# with a bare `   └─ expected: ...`, a tree item under no tree at all
# (rule.require.consistent-skill-contracts).
belay() {
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.s3.list"
  echo "   ├─ $1"
  echo "   └─ $2"
  exit 2
}

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin skill.
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, `shift 2` with a single arg left is
#      an ERROR in bash, so under `set -e` the run died with not one line printed
#   2. a FLAG token — `--bucket --prefix x` would otherwise set BUCKET='--prefix' and eat
#      the next flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value, $3 = optional comma-joined valid set
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.s3.list"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.s3.list help"
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) show_help ;;
    --uri) require_val --uri "${2:-}"; URI="$2"; shift 2 ;;
    --bucket) require_val --bucket "${2:-}"; BUCKET="$2"; shift 2 ;;
    --prefix) require_val --prefix "${2:-}"; PREFIX="$2"; shift 2 ;;
    --since) require_val --since "${2:-}"; SINCE="$2"; shift 2 ;;
    --limit) require_val --limit "${2:-}"; LIMIT="$2"; shift 2 ;;
    --env) require_val --env "${2:-}" "test,prep,prod"; ENV="$2"; shift 2 ;;
    --skill) shift 2 ;;  # ignore rhx passthrough
    --repo) shift 2 ;;   # ignore rhx passthrough
    --role) shift 2 ;;   # ignore rhx passthrough
    *) belay "unknown argument: $1" "hint: rhx aws.s3.list help" ;;
  esac
done

# validate --env (required, no default)
if [[ -z "$ENV" ]]; then
  belay "absent required arg: --env" "must be: test, prep, or prod"
fi

# the closed set was never checked here, though every kin skill checks it — so `--env prd`
# reached the keyrack, found no profile for a nonexistent env, and reported an absent
# CREDENTIAL rather than the typo that caused it (rule.require.errors-name-the-fix).
if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  belay "invalid env: $ENV" "must be: test, prep, or prod"
fi

# validate --since format early (before keyrack check)
if [[ -n "$SINCE" ]]; then
  if ! [[ "$SINCE" =~ ^[0-9]+[mhd]$ ]]; then
    belay "invalid --since: $SINCE" "must be: Nm, Nh, or Nd (e.g. 30m, 1h, 7d)"
  fi
fi

# `--limit` was never validated, so a non-numeric value reached `head -n "$LIMIT"` and died
# with head's own usage text at column 0, under no tree and behind no belay.
if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  belay "invalid --limit: $LIMIT" "must be: a whole number (e.g. 50)"
fi

# parse --uri if provided
if [[ -n "$URI" ]]; then
  # extract bucket and prefix from s3://bucket/prefix format
  if [[ "$URI" =~ ^s3://([^/]+)/?(.*)?$ ]]; then
    BUCKET="${BASH_REMATCH[1]}"
    PREFIX="${BASH_REMATCH[2]}"
  else
    belay "invalid --uri: $URI" "must be: s3://bucket/prefix"
  fi
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.s3.list"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi
  export AWS_PROFILE
fi

# list buckets if no bucket specified
if [[ -z "$BUCKET" ]]; then
  echo "🐈 chartin course..."
  echo ""
  echo "🔮 aws.s3.list --env $ENV"

  # the failure arm used to print `   └─ 🐈 wet paws... <aws said>` — a MASCOT nested inside
  # a tree item, which no kin skill does and no reader expects. a mascot opens a block at
  # column 0; buried at depth 3 it opens no block and closes none. the tree is closed first,
  # then the belay stands on its own (rule.require.consistent-skill-contracts).
  BUCKETS=$(aws s3 ls 2>&1) || {
    echo "   └─ halted: could not list buckets"
    echo ""
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.s3.list"
    echo "   ├─ aws said: ${BUCKETS:-(no detail)}"
    echo "   └─ hint: check the session for env=$ENV, then retry"
    exit 1
  }

  if [[ -z "$BUCKETS" ]]; then
    echo "   └─ (no buckets found)"
    exit 0
  fi

  TOTAL=$(echo "$BUCKETS" | grep -c . || echo "0")
  echo "   ├─ found: $TOTAL buckets"
  echo "   └─ buckets"

  # determine how many to show
  SHOW_COUNT=$TOTAL
  if [[ "$TOTAL" -gt "$LIMIT" ]]; then
    SHOW_COUNT=$LIMIT
  fi

  # output buckets with proper tree close
  IDX=0
  echo "$BUCKETS" | head -n "$LIMIT" | while IFS= read -r line; do
    if [[ -n "$line" ]]; then
      IDX=$((IDX + 1))
      # format: date time bucket_name
      BUCKET_NAME=$(echo "$line" | awk '{print $3}')
      DATE=$(echo "$line" | awk '{print $1}')
      if [[ "$IDX" -eq "$SHOW_COUNT" && "$TOTAL" -le "$LIMIT" ]]; then
        echo "      └─ $BUCKET_NAME ($DATE)"
      else
        echo "      ├─ $BUCKET_NAME ($DATE)"
      fi
    fi
  done

  if [[ "$TOTAL" -gt "$LIMIT" ]]; then
    echo "      └─ ... and $((TOTAL - LIMIT)) more"
  fi

  # the close used to be a BARE mascot with no artifact block under it, so the run ended on
  # a cat and no verdict (rule.require.status-feedback).
  echo ""
  echo "🐈 smooth sailin!"
  echo ""
  echo "🔮 aws.s3.list --env $ENV"
  echo "   └─ $TOTAL buckets"
  exit 0
fi

# list objects in bucket
echo "🐈 chartin course..."
echo ""
if [[ -n "$URI" ]]; then
  echo "🔮 aws.s3.list --env $ENV --uri $URI"
else
  echo "🔮 aws.s3.list --env $ENV --bucket $BUCKET${PREFIX:+ --prefix $PREFIX}"
fi

# .what = the terminal block EVERY object-list arm closes on
#
# .why  = three of the four arms — prefix-not-found, no-objects, and all-filtered-out —
#         used to `exit 0` on their tree item alone. so an empty result ended the run on
#         `chartin course...` with no verdict, while the populated arm answered with
#         `🐈 smooth sailin!` and a count. one skill, one question, two shapes, and the
#         shape depended on how many objects happened to be there
#         (rule.require.consistent-skill-contracts, at the render layer).
#
# .note = a function rather than four copies, so a later edit cannot drift one arm off
#         the others again — which is exactly how the drift started.
close_object_list() {
  echo ""
  echo "🐈 smooth sailin!"
  echo ""
  if [[ -n "$URI" ]]; then
    echo "🔮 aws.s3.list --env $ENV --uri $URI"
  else
    echo "🔮 aws.s3.list --env $ENV --bucket $BUCKET${PREFIX:+ --prefix $PREFIX}"
  fi
  echo "   └─ $1"
}

# build s3 path
S3_PATH="s3://$BUCKET/"
if [[ -n "$PREFIX" ]]; then
  S3_PATH="s3://$BUCKET/$PREFIX"
fi

# get objects
# note: aws s3 ls returns exit 0 even for non-existent prefix in valid bucket
echo "   ├─ path: $S3_PATH"

# the two streams are kept APART, because the exit-1 branch below tells a prefix-that-holds-
# no-object (silent stderr) from a real failure (stderr with a message) — merge them and
# that distinction is lost.
#
# `mktemp` rather than the two FIXED `/tmp/aws_s3_ls_*.txt` paths this used to write: a
# fixed name in a world-writable directory is a collision between two concurrent runs and a
# symlink an attacker can pre-place. the trap removes them on every exit path, including the
# belays below, which the old `rm -f` on the happy line did not.
LS_OUT=$(mktemp)
LS_ERR=$(mktemp)
trap 'rm -f "$LS_OUT" "$LS_ERR"' EXIT
aws s3 ls "$S3_PATH" --recursive > "$LS_OUT" 2> "$LS_ERR" && AWS_EXIT=0 || AWS_EXIT=$?
OBJECTS=$(cat "$LS_OUT")
AWS_ERR=$(cat "$LS_ERR")

# handle no objects case: aws returns 1 with empty stderr for nonexistent prefix
# but returns 1 with error message for actual failures (like bad bucket)
if [[ $AWS_EXIT -ne 0 ]]; then
  if [[ -n "$AWS_ERR" ]]; then
    # as above: the mascot belongs at column 0, never nested inside a tree item
    echo "   └─ halted: could not list objects"
    echo ""
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.s3.list"
    echo "   ├─ aws said: $AWS_ERR"
    echo "   └─ hint: check the bucket name and the session for env=$ENV"
    exit 1
  fi
  # aws returned 1 but no error message = prefix not found = empty result
  echo "   └─ (empty)"
  close_object_list "0 objects"
  exit 0
fi

if [[ -z "$OBJECTS" ]]; then
  echo "   └─ (empty)"
  close_object_list "0 objects"
  exit 0
fi

# filter by time if --since provided
if [[ -n "$SINCE" ]]; then
  # convert since to seconds
  SINCE_SECONDS=0
  if [[ "$SINCE" =~ ^([0-9]+)h$ ]]; then
    SINCE_SECONDS=$((${BASH_REMATCH[1]} * 3600))
  elif [[ "$SINCE" =~ ^([0-9]+)d$ ]]; then
    SINCE_SECONDS=$((${BASH_REMATCH[1]} * 86400))
  elif [[ "$SINCE" =~ ^([0-9]+)m$ ]]; then
    SINCE_SECONDS=$((${BASH_REMATCH[1]} * 60))
  else
    echo "🐈 belay that... invalid --since format: $SINCE" >&2
    echo "   └─ expected: Nm, Nh, or Nd (e.g., 30m, 1h, 7d)" >&2
    exit 2
  fi

  NOW=$(date +%s)
  CUTOFF=$((NOW - SINCE_SECONDS))

  # filter objects by date
  FILTERED=""
  while IFS= read -r line; do
    # parse date from s3 ls output: "2024-01-15 10:30:45"
    OBJ_DATE=$(echo "$line" | awk '{print $1 " " $2}')
    if [[ -n "$OBJ_DATE" && "$OBJ_DATE" != " " ]]; then
      OBJ_TS=$(date -d "$OBJ_DATE" +%s 2>/dev/null || echo "0")
      if [[ "$OBJ_TS" -ge "$CUTOFF" ]]; then
        FILTERED+="$line"$'\n'
      fi
    fi
  done <<< "$OBJECTS"
  OBJECTS="$FILTERED"

  # check if filter resulted in empty
  if [[ -z "$OBJECTS" || "$OBJECTS" == $'\n' ]]; then
    echo "   └─ (empty since $SINCE)"
    close_object_list "0 objects (since $SINCE)"
    exit 0
  fi
fi

# count and limit
if [[ -z "$OBJECTS" ]]; then
  TOTAL=0
else
  TOTAL=$(echo "$OBJECTS" | grep -c . 2>/dev/null || echo "0")
fi
echo "   ├─ found: $TOTAL objects${SINCE:+ (since $SINCE)}"

# show objects
echo "   └─ objects"
SHOW_COUNT=$(echo "$OBJECTS" | head -n "$LIMIT" | grep -c . 2>/dev/null || echo "0")
HAS_MORE=$([[ "$TOTAL" -gt "$LIMIT" ]] && echo "true" || echo "false")
INDEX=0
echo "$OBJECTS" | head -n "$LIMIT" | while IFS= read -r line; do
  if [[ -n "$line" ]]; then
    INDEX=$((INDEX + 1))
    # format: date time size key
    SIZE=$(echo "$line" | awk '{print $3}')
    KEY=$(echo "$line" | awk '{print $4}')
    DATE=$(echo "$line" | awk '{print $1}')
    TIME=$(echo "$line" | awk '{print $2}')
    # use └─ for last item only if no "more" line follows
    if [[ "$INDEX" -eq "$SHOW_COUNT" && "$HAS_MORE" == "false" ]]; then
      echo "      └─ $KEY ($SIZE bytes, $DATE $TIME)"
    else
      echo "      ├─ $KEY ($SIZE bytes, $DATE $TIME)"
    fi
  fi
done

if [[ "$TOTAL" -gt "$LIMIT" ]]; then
  echo "      └─ ... and $((TOTAL - LIMIT)) more"
fi

# the close used to be a BARE mascot with no artifact block under it, so the run ended on a
# cat and no verdict (rule.require.status-feedback).
close_object_list "$TOTAL objects${SINCE:+ (since $SINCE)}"
exit 0
