#!/usr/bin/env bash
# enable-rds-data.sh
# safely enable the RDS Data API for an Aurora cluster and create/update a Secrets Manager secret
# usage:
#   ./enable-rds-data.sh \
#     --cluster-id my-aurora-cluster \
#     --secret-name mydbsecret \
#     --username api_user
#   # optional ways to provide the password:
#   #   1) --password 'SuperSecret!'
#   #   2) export DB_PASSWORD='SuperSecret!' (env var)
#   #   3) omit both and you'll be prompted securely

set -euo pipefail

############################################################
# parse args
############################################################
CLUSTER_ID=""
SECRET_NAME=""
DB_USERNAME=""
DB_PASSWORD="${DB_PASSWORD:-}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
KMS_KEY_ID=""
FORCE="false"

err() { echo "❌ $*" >&2; }
die() { err "$@"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-id) CLUSTER_ID="$2"; shift 2 ;;
    --secret-name) SECRET_NAME="$2"; shift 2 ;;
    --username) DB_USERNAME="$2"; shift 2 ;;
    --password) DB_PASSWORD="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --kms-key-id) KMS_KEY_ID="$2"; shift 2 ;;
    --force) FORCE="true"; shift 1 ;;
    -h|--help)
      sed -n '1,50p' "$0"; exit 0 ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
done

[[ -n "$CLUSTER_ID" ]] || die "please provide --cluster-id"
[[ -n "$SECRET_NAME" ]] || die "please provide --secret-name"
[[ -n "$DB_USERNAME" ]] || die "please provide --username"
[[ -n "$REGION" ]] || die "please provide --region or set AWS_REGION"

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
HTTP_ENABLED="$(echo "$CLUSTER_JSON" | jq -r '.HttpEndpointEnabled // false')"
ENGINE_MODE="$(echo "$CLUSTER_JSON" | jq -r '.EngineMode // "provisioned"')"
SERVERLESS_V2_SCALING="$(echo "$CLUSTER_JSON" | jq -r '.ServerlessV2ScalingConfiguration // empty')"

case "$ENGINE" in
  aurora-mysql|aurora-postgresql) : ;;
  *) die "unsupported engine '$ENGINE' (requires aurora-mysql or aurora-postgresql)" ;;
esac

############################################################
# enable data api (http endpoint) if needed
############################################################
if [[ "$HTTP_ENABLED" != "true" ]]; then
  if [[ "$FORCE" != "true" ]]; then
    echo "⚠️  data api is currently disabled. this will modify the cluster."
    read -r -p "proceed to enable Data API on '$CLUSTER_ID'? [y/N]: " yn
    case "$yn" in [yY][eE][sS]|[yY]) ;; *) die "aborted by user";; esac
  fi

  echo "🔧 enabling Data API (http endpoint) on cluster..."

  # determine which command to use based on cluster type
  # aurora serverless v1 uses modify-db-cluster
  # aurora serverless v2 and provisioned use enable-http-endpoint
  if [[ "$ENGINE_MODE" == "serverless" ]]; then
    echo "  ├─ detected Aurora Serverless v1, using modify-db-cluster..."
    aws rds modify-db-cluster \
      --region "$REGION" \
      --db-cluster-identifier "$CLUSTER_ID" \
      --enable-http-endpoint \
      --apply-immediately >/dev/null
  else
    echo "  ├─ detected Aurora Serverless v2/provisioned, using enable-http-endpoint..."
    aws rds enable-http-endpoint \
      --region "$REGION" \
      --resource-arn "$CLUSTER_ARN" >/dev/null
  fi

  echo "⏳ waiting for cluster to become available..."
  aws rds wait db-cluster-available \
    --region "$REGION" \
    --db-cluster-identifier "$CLUSTER_ID"

  # poll for http endpoint to become enabled (up to 15 seconds)
  echo "⏳ waiting for Data API flag to enable..."
  RETRY_COUNT=0
  MAX_RETRIES=60 # takes up to 60 seconds some times
  while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
    HTTP_ENABLED="$(aws rds describe-db-clusters \
      --region "$REGION" \
      --db-cluster-identifier "$CLUSTER_ID" \
      --query 'DBClusters[0].HttpEndpointEnabled' \
      --output text)"

    if [[ "$HTTP_ENABLED" == "true" ]]; then
      echo "  └─ enabled after $((RETRY_COUNT + 1)) attempt(s)"
      break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
      echo "  ├─ attempt $RETRY_COUNT: not yet enabled, retrying..."
      sleep 1
    else
      echo "  └─ attempt $RETRY_COUNT: timeout reached"
    fi
  done
fi

if [[ "$HTTP_ENABLED" != "true" ]]; then
  echo ""
  echo "❌ Data API failed to enable. Gathering diagnostics..."

  # fetch full cluster details for diagnostics
  DIAGNOSTIC_JSON="$(aws rds describe-db-clusters \
    --region "$REGION" \
    --db-cluster-identifier "$CLUSTER_ID" \
    --query 'DBClusters[0]' \
    --output json)"

  CLUSTER_STATUS="$(echo "$DIAGNOSTIC_JSON" | jq -r '.Status')"
  ENGINE_VERSION="$(echo "$DIAGNOSTIC_JSON" | jq -r '.EngineVersion')"
  PENDING_MODS="$(echo "$DIAGNOSTIC_JSON" | jq -r '.PendingModifiedValues // empty')"

  echo "📊 Diagnostic Information:"
  echo "  Cluster Status:        $CLUSTER_STATUS"
  echo "  Engine:                $ENGINE"
  echo "  Engine Mode:           $ENGINE_MODE"
  echo "  Engine Version:        $ENGINE_VERSION"
  echo "  Region:                $REGION"
  echo "  HttpEndpointEnabled:   $HTTP_ENABLED"

  if [[ -n "$PENDING_MODS" && "$PENDING_MODS" != "null" && "$PENDING_MODS" != "{}" ]]; then
    echo "  Pending Modifications: $(echo "$PENDING_MODS" | jq -c .)"
  fi

  die "failed to enable Data API (http endpoint)"
fi

echo "✅ Data API enabled."

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
# summary + sample call
############################################################
cat <<EOF

🎉 done.

cluster:
  id:        $CLUSTER_ID
  arn:       $CLUSTER_ARN
  engine:    $ENGINE
  port:      $PORT
  writer:    $WRITER_ENDPOINT
  data api:  enabled

secret:
  name:      $SECRET_NAME
  arn:       $SECRET_ARN
  fields:    username, password, engine, host, reader_host, port, dbname

sample execute-statement:
  aws rds-data execute-statement \\
    --region $REGION \\
    --resource-arn "$CLUSTER_ARN" \\
    --secret-arn "$SECRET_ARN" \\
    --database "__dbname__" \\
    --sql "SELECT 1"

note:
- the secret must contain creds for an existing db user with appropriate privileges.
- ensure your caller's IAM policy allows: rds-data:ExecuteStatement, secretsmanager:GetSecretValue.
EOF
