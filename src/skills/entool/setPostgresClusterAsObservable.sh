#!/bin/bash
# .what = enable observability features on Aurora PostgreSQL cluster
# .why = configures CloudWatch Logs and Performance Insights for query monitoring

set -euo pipefail

# parse arguments
DB_CLUSTER_IDENTIFIER="${1:-}"

# validate input
if [[ -z "$DB_CLUSTER_IDENTIFIER" ]]; then
  echo "❌ Error: DB cluster identifier is required"
  echo "Usage: $0 <db-cluster-identifier>"
  exit 1
fi

echo "🔍 Configuring observability for cluster: $DB_CLUSTER_IDENTIFIER"
echo ""

# check if cluster exists
echo "📋 Verifying cluster exists..."
if ! aws rds describe-db-clusters \
  --db-cluster-identifier "$DB_CLUSTER_IDENTIFIER" \
  --query 'DBClusters[0].DBClusterIdentifier' \
  --output text &>/dev/null; then
  echo "❌ Error: Cluster '$DB_CLUSTER_IDENTIFIER' not found"
  exit 1
fi

echo "✅ Cluster found"
echo ""

# enable cloudwatch logs export
echo "📊 Enabling CloudWatch Logs export for PostgreSQL..."
aws rds modify-db-cluster \
  --db-cluster-identifier "$DB_CLUSTER_IDENTIFIER" \
  --cloudwatch-logs-export-configuration '{"EnableLogTypes":["postgresql"]}' \
  --apply-immediately \
  --no-cli-pager

echo "✅ CloudWatch Logs export enabled"
echo ""

# enable performance insights on all cluster instances
echo "🔬 Enabling Performance Insights on cluster instances..."

# get all instance identifiers for this cluster
INSTANCE_IDS=$(aws rds describe-db-clusters \
  --db-cluster-identifier "$DB_CLUSTER_IDENTIFIER" \
  --query 'DBClusters[0].DBClusterMembers[].DBInstanceIdentifier' \
  --output text)

if [[ -z "$INSTANCE_IDS" ]]; then
  echo "⚠️  Warning: No instances found for cluster (serverless v2 may not have instances)"
else
  for INSTANCE_ID in $INSTANCE_IDS; do
    echo "  Enabling on instance: $INSTANCE_ID"

    # check if already enabled
    PI_ENABLED=$(aws rds describe-db-instances \
      --db-instance-identifier "$INSTANCE_ID" \
      --query 'DBInstances[0].PerformanceInsightsEnabled' \
      --output text 2>/dev/null || echo "None")

    if [[ "$PI_ENABLED" == "True" ]]; then
      echo "  ✓ Performance Insights already enabled on $INSTANCE_ID"
    else
      aws rds modify-db-instance \
        --db-instance-identifier "$INSTANCE_ID" \
        --enable-performance-insights \
        --performance-insights-retention-period 7 \
        --apply-immediately \
        --no-cli-pager
      echo "  ✅ Performance Insights enabled on $INSTANCE_ID"
    fi
  done
fi

# configure parameter group for query logging
echo "📝 Configuring parameter group for query logging..."

# get current parameter group name
PARAM_GROUP=$(aws rds describe-db-clusters \
  --db-cluster-identifier "$DB_CLUSTER_IDENTIFIER" \
  --query 'DBClusters[0].DBClusterParameterGroup' \
  --output text)

echo "  Current parameter group: $PARAM_GROUP"

# check if using default parameter group
if [[ "$PARAM_GROUP" == default.* ]]; then
  echo "  ⚠️  Warning: Using default parameter group - cannot modify default parameter groups"
  echo "  ⚠️  Skipping parameter group configuration"
  echo ""
  echo "  💡 To enable query logging, create a custom parameter group and apply it to the cluster:"
  echo "     1. Create custom parameter group based on $PARAM_GROUP"
  echo "     2. Set log_statement=mod and log_min_duration_statement=1000"
  echo "     3. Apply the custom parameter group to cluster: $DB_CLUSTER_IDENTIFIER"
  echo ""
else
  # modify existing custom parameter group

  # check current parameter values before modification
  echo "  Checking current parameter values..."

  CURRENT_LOG_STATEMENT=$(aws rds describe-db-cluster-parameters \
    --db-cluster-parameter-group-name "$PARAM_GROUP" \
    --query "Parameters[?ParameterName=='log_statement'].ParameterValue" \
    --output text)

  CURRENT_LOG_DURATION=$(aws rds describe-db-cluster-parameters \
    --db-cluster-parameter-group-name "$PARAM_GROUP" \
    --query "Parameters[?ParameterName=='log_min_duration_statement'].ParameterValue" \
    --output text)

  echo "  Current log_statement: ${CURRENT_LOG_STATEMENT:-none}"
  echo "  Current log_min_duration_statement: ${CURRENT_LOG_DURATION:--1}"

  # modify parameter group settings for query logging
  echo "  Setting log_statement=mod (logs DDL and DML statements)..."
  aws rds modify-db-cluster-parameter-group \
    --db-cluster-parameter-group-name "$PARAM_GROUP" \
    --parameters "ParameterName=log_statement,ParameterValue=mod,ApplyMethod=immediate" \
    --no-cli-pager

  echo "  Setting log_min_duration_statement=1000 (log queries > 1 second)..."
  aws rds modify-db-cluster-parameter-group \
    --db-cluster-parameter-group-name "$PARAM_GROUP" \
    --parameters "ParameterName=log_min_duration_statement,ParameterValue=1000,ApplyMethod=immediate" \
    --no-cli-pager

  echo "✅ Parameter group configured for query logging"
  echo ""
fi

echo "🎉 Observability configuration complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Wait 5-10 minutes for changes to apply (parameter changes may require reboot)"
echo "  2. Verify CloudWatch Logs:"
echo "     aws logs tail /aws/rds/cluster/$DB_CLUSTER_IDENTIFIER/postgresql --since 5m"
echo ""
echo "  3. Query Performance Insights:"
echo "     aws pi describe-dimension-keys --service-type RDS --identifier <resource-id>"
echo ""
echo "  4. Run the usage report:"
echo "     npx tsx src/skills/monitor/queryApis/reportPostgresServerlessUsage.ts"
echo ""
