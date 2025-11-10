given(an s3 bucket)
  when([t1] asked to setS3BucketTierOptimization)
    then(it applies intelligent tiering config)

via both



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
