#!/usr/bin/env bash
# upsertRdsDataApiCredentials.sh
# find or update a Secrets Manager secret for RDS Data API access
# usage:
#   ./upsertRdsDataApiCredentials.sh \
#     --cluster-id my-aurora-cluster \
#     --username api_user
#   # secret name will be auto-generated as: rds-db-credentials/$CLUSTER_ID/user/$DB_USERNAME/rds-data-api
#   # optional ways to provide the password:
#   #   1) --password 'SuperSecret!'
#   #   2) export DB_PASSWORD='SuperSecret!' (env var)
#   #   3) omit both and you'll be prompted securely

set -euo pipefail

############################################################
# parse args
############################################################
CLUSTER_ID=""
DB_USERNAME=""
DB_PASSWORD="${DB_PASSWORD:-}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
KMS_KEY_ID=""

err() { echo "❌ $*" >&2; }
die() { err "$@"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-id) CLUSTER_ID="$2"; shift 2 ;;
    --username) DB_USERNAME="$2"; shift 2 ;;
    --password) DB_PASSWORD="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --kms-key-id) KMS_KEY_ID="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,50p' "$0"; exit 0 ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
done

[[ -n "$CLUSTER_ID" ]] || die "please provide --cluster-id"
[[ -n "$DB_USERNAME" ]] || die "please provide --username"
[[ -n "$REGION" ]] || die "please provide --region or set AWS_REGION"

# auto-generate secret name
SECRET_NAME="rds-db-credentials/$CLUSTER_ID/user/$DB_USERNAME/rds-data-api"
echo "🏷️  secret name: $SECRET_NAME"

if [[ -z "$DB_PASSWORD" ]]; then
  read -r -s -p "enter password for database user '$DB_USERNAME': " DB_PASSWORD
  echo ""
  [[ -n "$DB_PASSWORD" ]] || die "empty password not allowed"
fi

need aws
aws sts get-caller-identity >/dev/null || die "unable to call AWS; check credentials"

############################################################
# look up cluster details
############################################################
echo "🔍 checking cluster '$CLUSTER_ID' in region '$REGION'..."
CLUSTER_JSON="$(aws rds describe-db-clusters \
  --region "$REGION" \
  --db-cluster-identifier "$CLUSTER_ID" \
  --query 'DBClusters[0]' \
  --output json || true)"

[[ "$CLUSTER_JSON" != "null" && -n "$CLUSTER_JSON" ]] || die "cluster '$CLUSTER_ID' not found"

ENGINE="$(echo "$CLUSTER_JSON" | jq -r '.Engine')"
PORT="$(echo "$CLUSTER_JSON" | jq -r '.Port')"
WRITER_ENDPOINT="$(echo "$CLUSTER_JSON" | jq -r '.Endpoint')"
READER_ENDPOINT="$(echo "$CLUSTER_JSON" | jq -r '.ReaderEndpoint')"
CLUSTER_ARN="$(echo "$CLUSTER_JSON" | jq -r '.DBClusterArn')"

case "$ENGINE" in
  aurora-mysql|aurora-postgresql) : ;;
  *) die "unsupported engine '$ENGINE' (requires aurora-mysql or aurora-postgresql)" ;;
esac

############################################################
# create or update the secret with connection info
############################################################
# build a rich secret payload to help tools auto-detect settings
SECRET_PAYLOAD="$(jq -n \
  --arg username "$DB_USERNAME" \
  --arg password "$DB_PASSWORD" \
  --arg engine "$ENGINE" \
  --arg host "$WRITER_ENDPOINT" \
  --arg reader "$READER_ENDPOINT" \
  --argjson port "$PORT" \
  '{
     username: $username,
     password: $password,
     engine: $engine,
     host: $host,
     reader_host: $reader,
     port: $port
   }'
)"

echo "🔐 ensuring secret '$SECRET_NAME' exists..."
set +e
EXISTING_ARN="$(aws secretsmanager describe-secret \
  --region "$REGION" \
  --secret-id "$SECRET_NAME" \
  --query 'ARN' \
  --output text 2>/dev/null)"
STATUS=$?
set -e

if [[ $STATUS -eq 0 && -n "$EXISTING_ARN" && "$EXISTING_ARN" != "None" ]]; then
  echo "📝 updating existing secret..."
  UPDATE_ARGS=(--region "$REGION" --secret-id "$SECRET_NAME" --secret-string "$SECRET_PAYLOAD")
  [[ -n "$KMS_KEY_ID" ]] && UPDATE_ARGS+=(--kms-key-id "$KMS_KEY_ID")
  aws secretsmanager update-secret "${UPDATE_ARGS[@]}" >/dev/null
  SECRET_ARN="$EXISTING_ARN"
else
  echo "🆕 creating new secret..."
  CREATE_ARGS=(--region "$REGION" --name "$SECRET_NAME" --secret-string "$SECRET_PAYLOAD")
  [[ -n "$KMS_KEY_ID" ]] && CREATE_ARGS+=(--kms-key-id "$KMS_KEY_ID")
  SECRET_ARN="$(aws secretsmanager create-secret "${CREATE_ARGS[@]}" --query 'ARN' --output text)"
fi

echo "✅ secret ready: $SECRET_ARN"

############################################################
# summary + usage instructions
############################################################
cat <<EOF

🎉 done.

cluster:
  id:        $CLUSTER_ID
  arn:       $CLUSTER_ARN
  engine:    $ENGINE
  port:      $PORT
  writer:    $WRITER_ENDPOINT
  reader:    $READER_ENDPOINT

secret:
  name:      $SECRET_NAME
  arn:       $SECRET_ARN
  fields:    username, password, engine, host, reader_host, port

usage with RDS Data API:
  aws rds-data execute-statement \\
    --region $REGION \\
    --resource-arn "$CLUSTER_ARN" \\
    --secret-arn "$SECRET_ARN" \\
    --database "__dbname__" \\
    --sql "SELECT 1"

note:
- the secret contains credentials for database user '$DB_USERNAME'
- for RDS Data API, ensure IAM policy allows: rds-data:ExecuteStatement, secretsmanager:GetSecretValue
EOF
