# S3 Storage Tier Comparison

## S3 Intelligent-Tiering (Automatic)

Intelligent-Tiering automatically moves objects between access tiers based on usage patterns. You pay a monitoring fee plus the storage cost for whichever tier the object is currently in.

**Monitoring Fee**: $0.0025 per 1,000 objects/month

| Intelligent-Tiering Level             | Access Latency       | Storage Cost (per GB/month) | Automatic Transition After      |
|---------------------------------------|----------------------|-----------------------------|---------------------------------|
| **Frequent Access**                   | Milliseconds         | $0.023                      | Default tier                    |
| **Infrequent Access**                 | Milliseconds         | $0.0125                     | 30 days without access          |
| **Archive Instant Access**            | Milliseconds         | $0.004                      | 90 days without access          |
| **Archive Access** (optional)         | Minutes to hours     | $0.0036                     | 180 days without access         |
| **Deep Archive Access** (optional)    | 12-48 hours          | $0.00099                    | 180 days without access         |

## Manual Storage Tiers (Fixed)

These storage classes require you to explicitly choose where to store your data. Objects remain in the chosen tier unless you manually move them.

| Storage Tier                          | Access Latency       | Storage Cost (per GB/month) | Retrieval Cost     | Minimum Storage Duration | Use Case                                |
|---------------------------------------|----------------------|-----------------------------|--------------------|--------------------------|---------------------------------------- |
| **S3 Standard**                       | Milliseconds         | $0.023                      | None               | None                     | Frequently accessed data                |
| **S3 Standard-IA**                    | Milliseconds         | $0.0125                     | $0.01 per GB       | 30 days                  | Infrequently accessed data              |
| **S3 One Zone-IA**                    | Milliseconds         | $0.01                       | $0.01 per GB       | 30 days                  | Infrequent access, non-critical data    |
| **S3 Glacier Instant Retrieval**      | Milliseconds         | $0.004                      | $0.03 per GB       | 90 days                  | Archive with instant access needs       |
| **S3 Glacier Flexible Retrieval**     | Minutes to hours     | $0.0036                     | $0.01-$0.03 per GB | 90 days                  | Archive with flexible retrieval         |
| **S3 Glacier Deep Archive**           | 12-48 hours          | $0.00099                    | $0.02 per GB       | 180 days                 | Long-term archive, rarely accessed      |

## Notes

- **Prices are approximate** and based on US East (N. Virginia) region. Actual costs vary by region.
- **Access Latency** refers to first-byte latency for retrieval operations
- **Retrieval Cost** applies when accessing or retrieving data from the tier
- **Minimum Storage Duration** - if objects are deleted before this duration, you're charged for the full duration
- **S3 Intelligent-Tiering** automatically moves objects between access tiers based on usage patterns
- All tiers except S3 One Zone-IA store data across multiple Availability Zones for 99.999999999% (11 9's) durability

## Cost Optimization Guidelines

1. **Standard** → **Standard-IA**: For data accessed less than once per month
2. **Standard-IA** → **Glacier Instant Retrieval**: For data accessed less than once per quarter
3. **Glacier Instant** → **Glacier Flexible**: For archival data with acceptable retrieval delays
4. **Glacier Flexible** → **Deep Archive**: For compliance/long-term archives with rare access

## Break-even Analysis

- **Standard vs Standard-IA**: Break-even at ~1 access per month per GB
- **Standard-IA vs Glacier Instant**: Break-even at ~1 access per quarter per GB
- **Glacier tiers**: Use when retrieval frequency is measured in months or years
