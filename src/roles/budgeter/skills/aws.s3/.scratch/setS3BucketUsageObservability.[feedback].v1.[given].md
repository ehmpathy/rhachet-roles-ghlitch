# Feedback: setS3BucketUsageObservability.sh v1

Review of `src/roles/budgeter/skills/aws.s3/setS3BucketUsageObservability.sh` against blueprint `src/roles/budgeter/skills/aws.s3/.behavior/3.[blueprint].observability.provisions.v1.i1.md`

## BLOCKERs

### BLOCKER-1: Table bucket naming does not follow blueprint specification

**Issue**: Script uses `s3-metadata-tables` as default table bucket name, but blueprint specifies `ghlitch-${ACCOUNT_ID_HASH}-tables` where `ACCOUNT_ID_HASH` is first 7 characters of SHA256 hash of account ID.

**Current implementation** (lines 72-75):
```bash
# set default table bucket name if not specified
if [[ -z "$TABLE_BUCKET_NAME" ]]; then
  TABLE_BUCKET_NAME="s3-metadata-tables"
fi
```

**Blueprint specification** (lines 31-33, 83-84):
```bash
# Analysis bucket will be auto-created: ghlitch-${ACCOUNT_ID_HASH}-objects
# S3 Tables bucket for metadata: ghlitch-${ACCOUNT_ID_HASH}-tables
ACCOUNT_ID_HASH=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-7)
BUCKET_TABLES="ghlitch-${ACCOUNT_ID_HASH}-tables"
```

**Impact**:
- Naming convention inconsistency across infrastructure
- Makes it harder to identify buckets belonging to specific accounts
- Breaks integration with other scripts expecting the standardized naming

**Required fix**:
```bash
# Calculate account ID hash for naming convention
ACCOUNT_ID_HASH=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-7)

# set default table bucket name if not specified
if [[ -z "$TABLE_BUCKET_NAME" ]]; then
  TABLE_BUCKET_NAME="ghlitch-${ACCOUNT_ID_HASH}-tables"
fi
```

---

### BLOCKER-2: Missing analysis bucket provisioning

**Issue**: Blueprint specifies that an analysis bucket (`ghlitch-${ACCOUNT_ID_HASH}-objects`) should be provisioned for Athena query results, but the script does not create or verify this bucket exists.

**Blueprint specification** (lines 31-32, 163-172):
```bash
# Analysis bucket will be auto-created: ghlitch-${ACCOUNT_ID_HASH}-objects
# Ensure analysis bucket exists for Athena results
BUCKET_ANALYSIS="ghlitch-${ACCOUNT_ID_HASH}-objects"
aws s3 mb "s3://${BUCKET_ANALYSIS}" 2>/dev/null || echo "Analysis bucket exists"
```

**Current implementation**: No analysis bucket creation or verification.

**Impact**:
- Users cannot immediately query metadata with Athena after setup
- Athena queries will fail without results bucket configured
- Incomplete observability setup (Step 3 from blueprint missing)

**Required fix**: Add analysis bucket creation after S3 Tables bucket creation:
```bash
# create analysis bucket for Athena query results
BUCKET_ANALYSIS="ghlitch-${ACCOUNT_ID_HASH}-objects"
echo "🔭 Checking analysis bucket: $BUCKET_ANALYSIS"
if aws s3api head-bucket --bucket "$BUCKET_ANALYSIS" 2>/dev/null; then
  echo "✓ Analysis bucket already exists"
else
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY RUN] Would create analysis bucket: $BUCKET_ANALYSIS"
  else
    echo "Creating analysis bucket: $BUCKET_ANALYSIS"
    if aws s3 mb "s3://${BUCKET_ANALYSIS}" --region "$REGION" 2>> "$ERROR_LOG"; then
      echo "✓ Created analysis bucket for Athena results"
    else
      echo "⚠️  Warning: Failed to create analysis bucket (Athena queries may fail)"
    fi
  fi
fi
```

**Note**: Store the analysis bucket name in report for use in query examples.
