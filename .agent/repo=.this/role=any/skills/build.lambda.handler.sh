#!/usr/bin/env bash
######################################################################
# .what = bundle and zip lambda handler for deployment
#
# .why  = enables lambda handler build without manual steps:
#         - bundles typescript with esbuild
#         - creates zip for declastruct deployment
#
# usage:
#   rhx build.lambda.handler --file provision/aws.infra/account=demo/.assets/handler.ts
#
# guarantee:
#   - bundles handler .ts to .js
#   - creates handler.zip in same directory
#   - fail-fast on errors
######################################################################
set -euo pipefail

# parse args
HANDLER_FILE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --file)
      HANDLER_FILE="$2"
      shift 2
      ;;
    --skill|--role|--repo)
      # ignore rhachet internal args
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

# validate
if [[ -z "$HANDLER_FILE" ]]; then
  echo "error: --file required" >&2
  exit 1
fi

if [[ ! -f "$HANDLER_FILE" ]]; then
  echo "error: $HANDLER_FILE not found" >&2
  exit 1
fi

# convert to absolute path (esbuild chokes on `=` in relative paths)
HANDLER_FILE_ABS="$(cd "$(dirname "$HANDLER_FILE")" && pwd)/$(basename "$HANDLER_FILE")"

# derive output names from input file
PARENT_DIR="$(dirname "$HANDLER_FILE_ABS")"
BASENAME="$(basename "$HANDLER_FILE_ABS" .ts)"
JS_FILE="$PARENT_DIR/$BASENAME.js"
ZIP_FILE="$PARENT_DIR/$BASENAME.zip"

# bundle with esbuild
# work around esbuild path parse issue with = character via tmp dir
echo "bundle $HANDLER_FILE_ABS..."
TMPDIR=$(mktemp -d)
cp "$HANDLER_FILE_ABS" "$TMPDIR/handler.ts"
npx esbuild "$TMPDIR/handler.ts" \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile="$TMPDIR/handler.js"

# keep as handler.js (not original filename) so aws lambda can parse handler path
# aws lambda chokes on filenames with multiple dots like "lambda.echoAncient.handler.js"
cp "$TMPDIR/handler.js" "$PARENT_DIR/handler.js"
rm -rf "$TMPDIR"

# create zip with handler.js inside (zip named after original file for traceability)
echo "create $ZIP_FILE..."
cd "$PARENT_DIR"
zip -j "$BASENAME.zip" "handler.js"
rm "handler.js"

echo "done: $ZIP_FILE"
