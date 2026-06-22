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

show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.s3.list"
  echo "   usage:"
  echo "     rhx aws.s3.list --env <env>                              # list buckets"
  echo "     rhx aws.s3.list --env <env> --uri s3://bucket/prefix/    # list objects"
  echo "     rhx aws.s3.list --env <env> --bucket <name>              # list objects"
  echo ""
  echo "   options:"
  echo "     --env       environment: test, prep, prod (required)"
  echo "     --uri       s3://bucket/prefix format"
  echo "     --bucket    s3 bucket name"
  echo "     --prefix    filter objects by prefix"
  echo "     --since     filter by recency (1h, 1d, 7d)"
  echo "     --limit     max results (default: 50)"
  echo "     --help      show this help"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) show_help ;;
    --uri) URI="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --skill) shift 2 ;;  # ignore rhx passthrough
    --repo) shift 2 ;;   # ignore rhx passthrough
    --role) shift 2 ;;   # ignore rhx passthrough
    *) echo "🐈 belay that... unknown option: $1" >&2; exit 2 ;;
  esac
done

# validate --env (required, no default)
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that... --env required" >&2
  exit 2
fi

# validate --since format early (before keyrack check)
if [[ -n "$SINCE" ]]; then
  if ! [[ "$SINCE" =~ ^[0-9]+[mhd]$ ]]; then
    echo "🐈 belay that... invalid --since format: $SINCE" >&2
    echo "   └─ expected: Nm, Nh, or Nd (e.g., 30m, 1h, 7d)" >&2
    exit 2
  fi
fi

# parse --uri if provided
if [[ -n "$URI" ]]; then
  # extract bucket and prefix from s3://bucket/prefix format
  if [[ "$URI" =~ ^s3://([^/]+)/?(.*)?$ ]]; then
    BUCKET="${BASH_REMATCH[1]}"
    PREFIX="${BASH_REMATCH[2]}"
  else
    echo "🐈 belay that... invalid --uri format, expected s3://bucket/prefix" >&2
    exit 2
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

  BUCKETS=$(aws s3 ls 2>&1) || {
    echo "   └─ 🐈 wet paws... $BUCKETS" >&2
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

  echo ""
  echo "🐈 smooth sailin!"
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

# build s3 path
S3_PATH="s3://$BUCKET/"
if [[ -n "$PREFIX" ]]; then
  S3_PATH="s3://$BUCKET/$PREFIX"
fi

# get objects
# note: aws s3 ls returns exit 0 even for non-existent prefix in valid bucket
echo "   ├─ path: $S3_PATH"
aws s3 ls "$S3_PATH" --recursive > /tmp/aws_s3_ls_out.txt 2> /tmp/aws_s3_ls_err.txt && AWS_EXIT=0 || AWS_EXIT=$?
OBJECTS=$(cat /tmp/aws_s3_ls_out.txt)
AWS_ERR=$(cat /tmp/aws_s3_ls_err.txt)
rm -f /tmp/aws_s3_ls_out.txt /tmp/aws_s3_ls_err.txt

# handle no objects case: aws returns 1 with empty stderr for nonexistent prefix
# but returns 1 with error message for actual failures (like bad bucket)
if [[ $AWS_EXIT -ne 0 ]]; then
  if [[ -n "$AWS_ERR" ]]; then
    echo "   └─ 🐈 wet paws... $AWS_ERR" >&2
    exit 1
  fi
  # aws returned 1 but no error message = prefix not found = empty result
  echo "   └─ (empty)"
  exit 0
fi

if [[ -z "$OBJECTS" ]]; then
  echo "   └─ (empty)"
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

echo ""
echo "🐈 smooth sailin!"
exit 0
