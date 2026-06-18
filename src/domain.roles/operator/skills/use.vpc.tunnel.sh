#!/usr/bin/env bash
######################################################################
# 🦺 use.vpc.tunnel — establish secure database tunnel
#
# .what = creates ssm tunnel to rds endpoint via ec2 bastion
#
# .why  = enables local database access without public rds exposure
#
# usage:
#   rhx use.vpc.tunnel --bastion vpc-main-bastion --cluster mydb
#   rhx use.vpc.tunnel --bastion vpc-main-bastion --cluster mydb --port 5433
#   rhx use.vpc.tunnel --bastion vpc-main-bastion --cluster mydb --host mydb.local
#   rhx use.vpc.tunnel --config ./tunnel.config.json
#   rhx use.vpc.tunnel help
#
# args:
#   --bastion   ssm target instance id (e.g., vpc-main-bastion)
#   --cluster   rds cluster name
#   --port      local port to bind (default: 5432)
#   --host      local hostname alias (requires sudo for /etc/hosts)
#   --config    path to json config file (alternative to args)
#
# guarantee:
#   - exit 0 = tunnel active
#   - exit 1 = malfunction (aws error, ssm failure)
#   - exit 2 = constraint (absent args, bad config)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# parse arguments
BASTION=""
CLUSTER=""
PORT="5432"
HOST=""
CONFIG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bastion)
      BASTION="$2"
      shift 2
      ;;
    --cluster)
      CLUSTER="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --config)
      CONFIG="$2"
      shift 2
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🦺 use.vpc.tunnel"
      echo ""
      echo "usage:"
      echo "  rhx use.vpc.tunnel --bastion <bastion-exid> --cluster <cluster-name>"
      echo "  rhx use.vpc.tunnel --bastion <bastion-exid> --cluster <cluster-name> --port 5433"
      echo "  rhx use.vpc.tunnel --bastion <bastion-exid> --cluster <cluster-name> --host mydb.local"
      echo "  rhx use.vpc.tunnel --config ./tunnel.config.json"
      echo ""
      echo "args:"
      echo "  --bastion   ssm target instance id (e.g., vpc-main-bastion)"
      echo "  --cluster   rds cluster name"
      echo "  --port      local port to bind (default: 5432)"
      echo "  --host      local hostname alias (requires sudo)"
      echo "  --config    path to json config file"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🦺 use.vpc.tunnel"
      echo "   ├─ unknown argument: $1"
      echo "   └─ hint: rhx use.vpc.tunnel help"
      exit 2
      ;;
  esac
done

# validate args or config
if [[ -z "$CONFIG" ]]; then
  if [[ -z "$BASTION" || -z "$CLUSTER" ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🦺 use.vpc.tunnel"
    echo "   ├─ absent required args: --bastion and --cluster"
    echo "   ├─ (or provide --config path)"
    echo "   └─ hint: rhx use.vpc.tunnel help"
    exit 2
  fi
fi

# unlock keyrack for aws credentials
source <(rhx keyrack unlock --owner ehmpath --env all)

# get aws account and region from caller identity
AWS_IDENTITY=$(aws sts get-caller-identity)
export AWS_ACCOUNT_ID=$(echo "$AWS_IDENTITY" | jq -r '.Account')
export AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

echo "🐈 chartin course..."
echo ""
echo "🦺 use.vpc.tunnel --bastion $BASTION --cluster $CLUSTER"
echo "   ├─ account: $AWS_ACCOUNT_ID"
echo "   ├─ region: $AWS_REGION"
echo "   ├─ bastion: $BASTION"
echo "   ├─ cluster: $CLUSTER"
echo "   ├─ port: $PORT"
echo "   └─ host: ${HOST:-none}"

# export config for typescript skill
export VPC_TUNNEL_BASTION="$BASTION"
export VPC_TUNNEL_CLUSTER="$CLUSTER"
export VPC_TUNNEL_PORT="$PORT"
export VPC_TUNNEL_HOST="$HOST"
export DECLASTRUCT_CONFIG="$CONFIG"

# run the declastruct skill
exec npx tsx "$SCRIPT_DIR/use.vpc.tunnel.ts"
