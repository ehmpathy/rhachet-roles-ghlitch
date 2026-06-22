#!/usr/bin/env bash
######################################################################
# 🔮 aws.s3.get — fetch s3 object contents
#
# .what = fetch and display s3 object contents
#
# .why  = enables quick access to s3 file contents for debug:
#         - view CloudFront log entries
#         - inspect config files
#         - auto-gunzips .gz files
#
# usage:
#   rhx aws.s3.get --env prod --uri s3://bucket/path/to/file.gz
#   rhx aws.s3.get --env prod --bucket mybucket --key logs/file.log
#   rhx aws.s3.get help
#
# options:
#   --env ENV       environment for aws credentials: test, prep, prod (required)
#   --uri URI       s3://bucket/key format (preferred, copy-paste friendly)
#   --bucket NAME   s3 bucket name (alternative to --uri)
#   --key PATH      object key (alternative to --uri)
#
# guarantee:
#   - exit 0 = fetch completed
#   - exit 1 = malfunction (aws error)
#   - exit 2 = constraint (absent args)
######################################################################
set -euo pipefail

# parse args
BUCKET=""
KEY=""
ENV=""
URI=""

show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.s3.get"
  echo "   usage:"
  echo "     rhx aws.s3.get --env <env> --uri s3://bucket/key              # fetch object"
  echo "     rhx aws.s3.get --env <env> --bucket <name> --key <path>       # fetch object"
  echo ""
  echo "   options:"
  echo "     --env       environment: test, prep, prod (required)"
  echo "     --uri       s3://bucket/key format (preferred)"
  echo "     --bucket    s3 bucket name (alternative)"
  echo "     --key       object key (alternative)"
  echo "     --help      show this help"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) show_help ;;
    --uri) URI="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
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

# parse --uri if provided
if [[ -n "$URI" ]]; then
  # extract bucket and key from s3://bucket/key format
  if [[ "$URI" =~ ^s3://([^/]+)/(.+)$ ]]; then
    BUCKET="${BASH_REMATCH[1]}"
    KEY="${BASH_REMATCH[2]}"
  else
    echo "🐈 belay that... invalid --uri format, expected s3://bucket/key" >&2
    exit 2
  fi
fi

# validate bucket and key
if [[ -z "$BUCKET" ]]; then
  echo "🐈 belay that... --uri or --bucket required" >&2
  exit 2
fi

if [[ -z "$KEY" ]]; then
  echo "🐈 belay that... --uri or --key required" >&2
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.s3.get"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi
  export AWS_PROFILE
fi

# determine cache path
REPO_ROOT="$(git rev-parse --show-toplevel)"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# extract extension from key (after gunzip if .gz)
if [[ "$KEY" == *.gz ]]; then
  # strip .gz, get rest extension
  KEY_WITHOUT_GZ="${KEY%.gz}"
  EXT="${KEY_WITHOUT_GZ##*.}"
else
  EXT="${KEY##*.}"
fi

# sanitize key for filesystem (replace / with __)
KEY_SANITIZED="${KEY//\//__}"

CACHE_DIR="$REPO_ROOT/.agent/.cache/repo=ghlitch/role=observer/skill=aws.s3.get/bucket=$BUCKET"
CACHE_FILE="$CACHE_DIR/key=$KEY_SANITIZED/asof=$NOW.$EXT"
mkdir -p "$(dirname "$CACHE_FILE")"

# fetch and cache (attempt first, output after)
FETCH_ERROR=""
if [[ "$KEY" == *.gz ]]; then
  if ! aws s3 cp --quiet "s3://$BUCKET/$KEY" - 2>/dev/null | gunzip > "$CACHE_FILE" 2>/dev/null; then
    FETCH_ERROR="failed to fetch or decompress"
  fi
else
  if ! aws s3 cp --quiet "s3://$BUCKET/$KEY" "$CACHE_FILE" 2>/dev/null; then
    FETCH_ERROR="failed to fetch"
  fi
fi

# output result
if [[ -n "$FETCH_ERROR" ]]; then
  echo "🐈 wet paws..."
  echo ""
  if [[ -n "$URI" ]]; then
    echo "🔮 aws.s3.get --env $ENV --uri $URI"
  else
    echo "🔮 aws.s3.get --env $ENV --bucket $BUCKET --key $KEY"
  fi
  echo "   └─ $FETCH_ERROR"
  exit 1
fi

echo "🐈 chartin course..."
echo ""
if [[ -n "$URI" ]]; then
  echo "🔮 aws.s3.get --env $ENV --uri $URI"
else
  echo "🔮 aws.s3.get --env $ENV --bucket $BUCKET --key $KEY"
fi

# output cache location
CACHE_RELPATH="${CACHE_FILE#$REPO_ROOT/}"
echo "   ├─ cached: $CACHE_RELPATH"

# preview first 3 lines for text files
if file "$CACHE_FILE" | grep -q "text"; then
  echo "   └─ preview"
  echo "      ├─"
  echo "      │"
  head -3 "$CACHE_FILE" | while IFS= read -r line || [[ -n "$line" ]]; do
    echo "      │  $line"
  done
  echo "      │"
  echo "      └─"
else
  echo "   └─ (binary file)"
fi

echo ""
echo "🐈 smooth sailin!"
