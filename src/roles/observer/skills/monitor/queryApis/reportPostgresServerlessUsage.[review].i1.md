# Code Review: reportPostgresServerlessUsage.ts

## Overall Assessment
**Status**: NEEDS REVISION
**Violations Found**: 8 major, 3 minor
**Compliance Level**: ~75%

---

## BLOCKERS (Must Fix)

### 1. **Nested `if/else` Blocks** (flow:narrative violation)
**Lines**: 340-348
**Severity**: BLOCKER
**Rule**: `flow:narrative` - eliminate nested `if/else`; use flat narrative structure

```typescript
// CURRENT (VIOLATION):
if (utilizationSpread < 30) {
  parts.push('Utilization was relatively stable throughout the period.');
} else if (utilizationSpread < 70) {
  parts.push('Utilization showed moderate variance across the period.');
} else {
  parts.push(
    'Utilization showed high variance, indicating bursty workloads.',
  );
}
```

**Fix**: Use early returns or extract to lookup/switch pattern
```typescript
// RECOMMENDED:
const getUtilizationNarrative = (spread: number): string => {
  if (spread < 30) return 'Utilization was relatively stable throughout the period.';
  if (spread < 70) return 'Utilization showed moderate variance across the period.';
  return 'Utilization showed high variance, indicating bursty workloads.';
};

parts.push(getUtilizationNarrative(utilizationSpread));
```

---

### 2. **Missing Paragraph Comments** (comment-discipline violation)
**Lines**: Multiple
**Severity**: BLOCKER
**Rule**: Every code paragraph must be preceded by a one-line `//` comment explaining *why*

**Missing comments at**:
- Line 89: `const allAcuValues = acuData.map((d) => d.acu);`
- Line 108: `const report: UtilizationReport = { ... }`
- Line 208-212: Time range calculation block
- Line 232-236: Data transformation block
- Line 247-255: Hourly bucketing logic
- Line 297-300: Capacity range calculation
- Line 302-310: Peak/lowest hour identification
- Line 313: `const parts: string[] = [];`

**Examples of violations**:

```typescript
// Line 208-212 MISSING COMMENT:
const endTime = new Date();
const startTime = new Date(
  endTime.getTime() - input.periodHours * 60 * 60 * 1000,
);

// SHOULD BE:
// define query time window
const endTime = new Date();
const startTime = new Date(
  endTime.getTime() - input.periodHours * 60 * 60 * 1000,
);
```

```typescript
// Line 247-255 MISSING COMMENT:
const hourlyBuckets = input.acuData.reduce<Map<string, number[]>>(
  (buckets, dataPoint) => {
    const hour = dataPoint.timestamp.substring(0, 13);
    const existing = buckets.get(hour) || [];
    return new Map(buckets).set(hour, [...existing, dataPoint.acu]);
  },
  new Map<string, number[]>(),
);

// SHOULD BE:
// group data points by hour using immutable reduce
const hourlyBuckets = input.acuData.reduce<Map<string, number[]>>(
  // ... (rest same)
);
```

---

### 3. **Domain Object Usage Violation** (arch:domain-driven-design)
**Lines**: 13-34
**Severity**: MAJOR
**Rule**: All business logic must use `domain-objects` (DomainLiteral/DomainEntity), not plain interfaces

**Current**:
```typescript
interface AcuDataPoint { ... }
interface HourlyStats { ... }
interface UtilizationReport { ... }
```

**Should be**:
```typescript
import { DomainLiteral } from 'domain-objects';

class AcuDataPoint extends DomainLiteral<AcuDataPoint> implements AcuDataPoint {
  timestamp!: string;
  acu!: number;
}

class HourlyStats extends DomainLiteral<HourlyStats> implements HourlyStats {
  hour!: string;
  min!: number;
  max!: number;
  avg!: number;
  dataPoints!: number;
}

class UtilizationReport extends DomainLiteral<UtilizationReport> implements UtilizationReport {
  clusterIdentifier!: string;
  periodHours!: number;
  hourlyStats!: HourlyStats[];
  overallMin!: number;
  overallMax!: number;
  overallAvg!: number;
  summary!: string;
}
```

**Impact**: Without domain objects, you lose:
- Runtime validation
- Immutability guarantees via `.clone()`
- Identity tracking
- Type safety at boundaries

---

## MAJOR ISSUES (Should Fix)

### 4. **Potential Mutation in Map Pattern** (vars:require-immutable concern)
**Lines**: 248-252
**Severity**: MAJOR
**Rule**: `vars:require-immutable` - all data structures must remain immutable

**Current**:
```typescript
const hourlyBuckets = input.acuData.reduce<Map<string, number[]>>(
  (buckets, dataPoint) => {
    const hour = dataPoint.timestamp.substring(0, 13);
    const existing = buckets.get(hour) || [];
    return new Map(buckets).set(hour, [...existing, dataPoint.acu]); // ✅ creates new Map
  },
  new Map<string, number[]>(),
);
```

**Analysis**: Actually CORRECT - creates new Map on each iteration. However, this is inefficient.

**Better approach** (object-based):
```typescript
const hourlyBuckets = input.acuData.reduce<Record<string, number[]>>(
  (buckets, dataPoint) => {
    const hour = dataPoint.timestamp.substring(0, 13);
    const existing = buckets[hour] || [];
    return { ...buckets, [hour]: [...existing, dataPoint.acu] };
  },
  {},
);
```

---

### 5. **Missing Fail-Fast Guards** (flow:fail-fast)
**Lines**: 204-237, 243-278
**Severity**: MAJOR
**Rule**: Validate inputs early and fail fast with `HelpfulError`

**Missing guards**:

```typescript
// In getServerlessCapacityMetrics (line 204):
const getServerlessCapacityMetrics = (
  input: { clusterIdentifier: string; periodHours: number },
  context: ContextLogTrail,
): AcuDataPoint[] => {
  // ADD: reject invalid period hours
  if (input.periodHours <= 0 || input.periodHours > 168) {
    throw new BadRequestError('periodHours must be between 1 and 168', { periodHours: input.periodHours });
  }

  // ADD: reject empty cluster identifier
  if (!input.clusterIdentifier?.trim()) {
    throw new BadRequestError('clusterIdentifier is required', { clusterIdentifier: input.clusterIdentifier });
  }

  // ... rest of function
};
```

```typescript
// In calculateHourlyStats (line 243):
const calculateHourlyStats = (
  input: { acuData: AcuDataPoint[] },
  _context: ContextLogTrail,
): HourlyStats[] => {
  // ADD: reject empty data
  if (!input.acuData || input.acuData.length === 0) {
    return []; // or throw depending on expected behavior
  }

  // ... rest of function
};
```

---

### 6. **No Idempotency Documentation** (proc:require-idempotency)
**Lines**: All procedures
**Severity**: MAJOR
**Rule**: All procedures must be idempotent or explicitly marked `.note = non-idempotent`

**Current**: No `.note` indicating idempotency status

**Analysis**:
- `getAuroraServerlessClusters` - ✅ idempotent (read-only)
- `getServerlessCapacityMetrics` - ✅ idempotent (read-only)
- `calculateHourlyStats` - ✅ idempotent (pure function)
- `generateUtilizationSummary` - ✅ idempotent (pure function)
- Main command - ❓ writes files - needs guard

**Recommendation**: Add `.note = idempotent; read-only query` to read procedures

For main command at line 45, add check:
```typescript
// skip if report already generated today
const reportExists = await context.out.exists({ name: 'final_utilization_report.json' });
if (reportExists) {
  context.log.info('report already generated, skipping...', {});
  return context.out.read({ name: 'final_utilization_report.json' });
}
```

---

## MINOR ISSUES (Nice to Have)

### 7. **Inconsistent Error Handling**
**Lines**: 192-196, 215-236
**Severity**: MINOR

No try/catch around `execAws` calls. If AWS CLI fails, error will be uncaught.

**Recommendation**: Wrap in try/catch with helpful context
```typescript
// wrap AWS calls with helpful errors
try {
  const clustersRaw = execAws(..., context);
  return parseJson<string[]>(clustersRaw).sort();
} catch (error) {
  throw new UnexpectedCodePathError(
    'failed to enumerate Aurora Serverless clusters',
    { cause: error }
  );
}
```

---

### 8. **Magic Numbers**
**Lines**: 136, 211
**Severity**: MINOR

```typescript
const bar = '█'.repeat(Math.ceil(stats.avg / 2)); // magic number: 2
```

**Recommendation**: Extract as named constant
```typescript
const ACU_HISTOGRAM_SCALE_FACTOR = 2;
const bar = '█'.repeat(Math.ceil(stats.avg / ACU_HISTOGRAM_SCALE_FACTOR));
```

---

### 9. **Unused Context Parameter Naming**
**Lines**: 245, 292
**Severity**: MINOR (style preference)

```typescript
const calculateHourlyStats = (
  input: { acuData: AcuDataPoint[] },
  _context: ContextLogTrail, // ← underscore prefix indicates unused
): HourlyStats[] => {
```

**Compliant**: Already using `_context` prefix pattern for unused params ✅

---

## COMPLIANT PATTERNS (Good Examples)

✅ **Proper `.what`/`.why` comments** on all exported procedures (lines 1-4, 184-187, 199-203, etc.)

✅ **Arrow function usage** throughout (lines 172-177, 180-182, 188-197)

✅ **`(input, context)` signature pattern** consistently applied (lines 45, 188, 204, 243, 284)

✅ **Immutable data transformations** using `.map()` and spread (lines 89, 233-236, 258-275)

✅ **Const-only variable declarations** (no `let` or `var`)

✅ **Fail-fast early return** at line 61-67 (checks for empty clusters)

✅ **Narrative step comments** at lines 48, 60, 74, 127 (uses "step N:" pattern)

✅ **File output using context.out.write** (lines 55-58, 118-121, 158-161)

---

## RECOMMENDATIONS SUMMARY

**Immediate (BLOCKER)**:
1. Flatten `if/else` chain at lines 340-348 → extract to helper function
2. Add missing paragraph `//` comments throughout (8+ locations)
3. Convert `interface` types to `domain-objects` (DomainLiteral)

**High Priority (MAJOR)**:
4. Add fail-fast input validation guards to all procedures
5. Document idempotency behavior in `.note` comments
6. Add try/catch with helpful errors around AWS CLI calls

**Low Priority (MINOR)**:
7. Extract magic numbers to named constants
8. Consider adding exists-check for idempotent file writes

---

## CODE QUALITY SCORE

| Category | Score | Notes |
|----------|-------|-------|
| Architecture | 7/10 | Missing domain objects, otherwise good |
| Code Style | 6/10 | Missing comments, has nested if/else |
| Immutability | 9/10 | Excellent const usage |
| Fail-Fast | 5/10 | Missing input validation |
| Signatures | 10/10 | Perfect `(input, context)` pattern |
| Comments | 4/10 | Has header docs, missing paragraph comments |
| **OVERALL** | **6.8/10** | **Needs revision before merge** |

---

## NEXT STEPS

1. Fix all BLOCKER issues (flatten if/else, add comments, convert to domain objects)
2. Add input validation guards
3. Document idempotency behavior
4. Re-run review to verify compliance