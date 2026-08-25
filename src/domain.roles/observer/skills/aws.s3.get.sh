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

# the help text used to indent `usage:` and `options:` to 3 spaces, under the artifact
# header — lines that are neither blank, nor a mascot, nor a header, nor a tree item, and a
# dialect no kin skill speaks. every other ghlitch skill sets these sections at column 0
# (rule.require.consistent-skill-contracts).
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.s3.get"
  echo ""
  echo "usage:"
  echo "  rhx aws.s3.get --env <env> --uri s3://bucket/key"
  echo "  rhx aws.s3.get --env <env> --bucket <name> --key <path>"
  echo ""
  echo "options:"
  echo "  --env       environment: test, prep, or prod"
  echo "  --uri       s3://bucket/key format (preferred)"
  echo "  --bucket    s3 bucket name (alternative)"
  echo "  --key       object key (alternative)"
  echo "  --help      show this help"
  echo ""
  echo "examples:"
  echo "  rhx aws.s3.get --env prep --uri s3://ahbode-logs/2026-08-12.log.gz"
  echo "  rhx aws.s3.get --env prep --bucket ahbode-logs --key 2026-08-12.log"
  exit 0
}

# every belay in this skill used to be a ONE-LINER — `🐈 belay that... --env required` on a
# single line, with no blank, no artifact header, and no tree. that is a dialect of its own:
# a human who learned the four-line block on every kin skill could not scan this one, and no
# `└─` ever closed what the mascot opened (rule.require.consistent-skill-contracts).
belay() {
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.s3.get"
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
#   2. a FLAG token — `--bucket --key x` would otherwise set BUCKET='--key' and eat the next
#      flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value, $3 = optional comma-joined valid set
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.s3.get"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.s3.get help"
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) show_help ;;
    --uri) require_val --uri "${2:-}"; URI="$2"; shift 2 ;;
    --bucket) require_val --bucket "${2:-}"; BUCKET="$2"; shift 2 ;;
    --key) require_val --key "${2:-}"; KEY="$2"; shift 2 ;;
    --env) require_val --env "${2:-}" "test,prep,prod"; ENV="$2"; shift 2 ;;
    --skill) shift 2 ;;  # ignore rhx passthrough
    --repo) shift 2 ;;   # ignore rhx passthrough
    --role) shift 2 ;;   # ignore rhx passthrough
    *) belay "unknown argument: $1" "hint: rhx aws.s3.get help" ;;
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

# parse --uri if provided
if [[ -n "$URI" ]]; then
  # extract bucket and key from s3://bucket/key format
  if [[ "$URI" =~ ^s3://([^/]+)/(.+)$ ]]; then
    BUCKET="${BASH_REMATCH[1]}"
    KEY="${BASH_REMATCH[2]}"
  else
    belay "invalid --uri: $URI" "must be: s3://bucket/key"
  fi
fi

# validate bucket and key
if [[ -z "$BUCKET" ]]; then
  belay "absent required arg: --uri or --bucket" "hint: rhx aws.s3.get help"
fi

if [[ -z "$KEY" ]]; then
  belay "absent required arg: --uri or --key" "hint: rhx aws.s3.get help"
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
#
# aws's OWN message is captured rather than discarded. `2>/dev/null` used to throw it away
# and report a generic "failed to fetch", which reads the same whether the key is absent,
# the bucket is another account's, or the session expired — three different fixes behind one
# indistinguishable line (rule.forbid.failhide-in-shell, rule.require.errors-name-the-fix).
# .note = `--only-show-errors`, never `--quiet`. `--quiet` silences aws's fatal-error line
#         along with its progress, so the capture below came back empty and every failure
#         rendered the placeholder `aws said: (no detail)` — the very generic message this
#         block exists to replace, reintroduced by the flag rather than by the redirect.
#         `--only-show-errors` drops the progress and keeps the diagnosis.
FETCH_ERROR=""
FETCH_SAID=""
if [[ "$KEY" == *.gz ]]; then
  # .note = fetch and decompress are SEPARATE steps, each with its own capture.
  #
  #         they used to be one pipeline, `aws ... - 2>&1 | gunzip > "$CACHE_FILE" 2>&1`,
  #         which fed aws's stderr INTO gunzip as though it were gzip bytes, and captured
  #         gunzip's complaint in place of aws's. so a 404 on a .gz key reported a
  #         decompression problem and aws's actual words reached no one.
  if ! FETCH_SAID=$(aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" "$CACHE_FILE.gz" 2>&1); then
    FETCH_ERROR="could not fetch"
  elif ! FETCH_SAID=$(gunzip -c "$CACHE_FILE.gz" 2>&1 > "$CACHE_FILE"); then
    FETCH_ERROR="could not decompress"
  fi
  rm -f "$CACHE_FILE.gz"
else
  if ! FETCH_SAID=$(aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" "$CACHE_FILE" 2>&1); then
    FETCH_ERROR="could not fetch"
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
  echo "   ├─ $FETCH_ERROR"
  # the tool's own words, as a tree item — so the reader learns WHICH of the three causes
  # it was. `(no detail)` rather than a bare blank when aws answered silently, because an
  # item with no text is a stray line, not a tree item.
  echo "   └─ aws said: ${FETCH_SAID:-(no detail)}"
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
#
# .note = the empty case is named, not lumped in with binary. a 0-byte object fell to the
#         `else` here and rendered `(binary file)`, which is simply untrue — and it sat one
#         line above `└─ fetched 0 bytes`, so the render contradicted itself in two
#         consecutive blocks (rule.forbid.ambiguous-labels).
if [[ ! -s "$CACHE_FILE" ]]; then
  echo "   └─ (empty file)"
elif file "$CACHE_FILE" | grep -q "text"; then
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

# the close used to be a BARE mascot with no artifact block under it, so the run ended on a
# cat and no verdict — a reader had to scroll up to learn what had happened
# (rule.require.status-feedback).
echo ""
echo "🐈 smooth sailin!"
echo ""
if [[ -n "$URI" ]]; then
  echo "🔮 aws.s3.get --env $ENV --uri $URI"
else
  echo "🔮 aws.s3.get --env $ENV --bucket $BUCKET --key $KEY"
fi
echo "   └─ fetched $(wc -c < "$CACHE_FILE" | tr -d ' ') bytes"
