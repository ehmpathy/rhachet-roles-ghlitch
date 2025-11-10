# Setting Up S3 Intelligent-Tiering

## Overview

S3 Intelligent-Tiering can be configured at the object level or automated via bucket lifecycle policies. The basic tiers (Frequent, Infrequent, Archive Instant) work automatically, but optional archive tiers require explicit configuration.

## Per-Bucket Configuration

### Option 1: Set Storage Class on Upload

When uploading objects, specify the Intelligent-Tiering storage class:

```bash
# AWS CLI
aws s3 cp myfile.txt s3://my-bucket/ --storage-class INTELLIGENT_TIERING

# Or for entire directory
aws s3 sync ./local-dir s3://my-bucket/ --storage-class INTELLIGENT_TIERING
```

### Option 2: Lifecycle Policy (Recommended for Existing Data)

Create a lifecycle policy to automatically transition objects to Intelligent-Tiering:

```bash
# Create lifecycle configuration JSON
cat > lifecycle-policy.json <<'EOF'
{
  "Rules": [
    {
      "Id": "TransitionToIntelligentTiering",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 0,
          "StorageClass": "INTELLIGENT_TIERING"
        }
      ]
    }
  ]
}
EOF

# Apply to bucket
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-bucket \
  --lifecycle-configuration file://lifecycle-policy.json
```

### Option 3: Enable Archive Tiers (Optional)

To use the Archive Access and Deep Archive Access tiers within Intelligent-Tiering, you must configure them per bucket:

```bash
# Configure bucket to enable optional archive tiers
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket my-bucket \
  --id MyArchiveConfig \
  --intelligent-tiering-configuration '{
    "Id": "MyArchiveConfig",
    "Status": "Enabled",
    "Tierings": [
      {
        "Days": 90,
        "AccessTier": "ARCHIVE_ACCESS"
      },
      {
        "Days": 180,
        "AccessTier": "DEEP_ARCHIVE_ACCESS"
      }
    ]
  }'
```

## Bucket-Level Settings Summary

| Configuration | Required? | Purpose |
|--------------|-----------|---------|
| Storage class (INTELLIGENT_TIERING) | Yes | Enable Intelligent-Tiering for objects |
| Lifecycle policy | No (but recommended) | Automatically transition existing objects |
| Archive tier configuration | No (optional) | Enable Archive Access and Deep Archive Access tiers |

## Verification

Check current configuration:

```bash
# View lifecycle policy
aws s3api get-bucket-lifecycle-configuration --bucket my-bucket

# View Intelligent-Tiering configuration
aws s3api get-bucket-intelligent-tiering-configuration \
  --bucket my-bucket \
  --id MyArchiveConfig

# Check object storage class
aws s3api head-object --bucket my-bucket --key myfile.txt
```

## Key Points

1. **Basic tiers work automatically** - Frequent Access, Infrequent Access, and Archive Instant Access require no configuration beyond setting the storage class
2. **Archive tiers are opt-in** - Archive Access and Deep Archive Access must be explicitly configured per bucket
3. **No retrieval fees** - Unlike manual Glacier tiers, Intelligent-Tiering has no retrieval charges
4. **Minimum object size** - Objects must be at least 128 KB to benefit from automatic tiering (smaller objects remain in Frequent Access)
5. **Monitoring fee applies** - $0.0025 per 1,000 objects regardless of size

## Cost Considerations

- **Best for**: Objects > 128 KB with unpredictable access patterns
- **Not ideal for**: Many small objects (monitoring fees exceed savings)
- **Break-even**: Generally worth it if you have uncertainty about access patterns and want to avoid manual management
