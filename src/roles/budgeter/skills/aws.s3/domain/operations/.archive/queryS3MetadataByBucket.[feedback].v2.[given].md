# Code Review: queryS3MetadataByBucket.ts

## BLOCKERs

### 1. **BLOCKER: Mutation with `let` variables (lines 124-125)**
- **Tactic**: `vars:require-immutable`
- **Issue**: Uses `let` for `queryState` and `attempts` variables which are mutated in a loop
- **Location**: Lines 124-125, 132, 145
```ts
let queryState = 'QUEUED';
let attempts = 0;
```
- **Fix**: Refactor polling loop into a recursive function or use a functional approach with immutable state tracking

### 2. **BLOCKER: Missing fail-fast guards**
- **Tactic**: `flow:fail-fast`
- **Issue**: Missing early validation of required inputs before executing expensive operations
- **Location**: Start of function (line 53)
- **Fix**: Add guards to validate `bucket.source.name`, `query`, `outputLocation` exist before proceeding
```ts
// reject if source bucket name missing
if (!bucket.source.name) throw new BadRequestError('bucket.source.name is required', { bucket });

// reject if query is empty
if (!query?.trim()) throw new BadRequestError('query cannot be empty', { query });
```

### 3. **BLOCKER: Generic Error instead of HelpfulError subclass**
- **Tactic**: `flow:fail-fast`
- **Issue**: Uses generic `Error` instead of `UnexpectedCodePathError` or `BadRequestError`
- **Location**: Lines 150, 163
```ts
throw new Error(`Query ${queryState}: ${reason}`);
throw new Error(`Query timed out after ${timeoutSeconds} seconds`);
```
- **Fix**: Use `UnexpectedCodePathError.throw()` or appropriate HelpfulError subclass with context

### 4. **BLOCKER: Synchronous execution blocking event loop**
- **Tactic**: `flow:narrative`, performance best practices
- **Issue**: Uses `execSync` for all AWS operations, blocking the event loop during long-running queries
- **Location**: Lines 70, 74, 79, 110, 134, 158, 169
- **Fix**: Convert to async function using `exec` from `child_process` with promises or use AWS SDK

### 5. **BLOCKER: Non-idempotent operation without marking**
- **Tactic**: `proc:require-idempotency`
- **Issue**: Function creates new Athena query execution on each call without checking for existing results or idempotency
- **Location**: Lines 110-115 (start-query-execution)
- **Fix**: Either implement idempotency (check for recent identical queries) or add `.note = non-idempotent` to header comment

## NITPICKs

### 1. **NITPICK: Missing procedure header `.how` explanation in main function**
- **Tactic**: `comment:discipline`
- **Issue**: Header comment at line 30-51 is excellent but should be on line 1-4 (main export), not duplicated
- **Location**: Lines 1-4 vs 30-51
- **Fix**: Keep detailed `.how` and example in main function header (line 53), simplify top comment

### 2. **NITPICK: Code paragraphs missing preceding blank line**
- **Tactic**: `flow:narrative`
- **Issue**: Several paragraph comments not preceded by blank line
- **Location**: Lines 67, 78, 88, 97, 102, 123, 185, 190
- **Fix**: Add blank line before each paragraph comment
```ts
const sourceBucketName = bucket.source.name;

// get aws account info
const region = ...
```

### 3. **NITPICK: Inline mutation in array operations**
- **Tactic**: `vars:require-immutable`
- **Issue**: While `.map()` is functional, the `rowData` object is mutated with `.forEach`
- **Location**: Lines 192-204
- **Fix**: Use `.reduce()` to build the object immutably:
```ts
const rows = resultsData.ResultSet.Rows.slice(1).map((row) =>
  row.Data.reduce((rowData, cell, idx) => {
    const columnName = columns[idx];
    if (!columnName) return rowData;
    const value = cell.VarCharValue;
    return {
      ...rowData,
      [columnName]: value !== undefined && value !== null ? value : null,
    };
  }, {} as Record<string, string | number | null>)
);
```

### 4. **NITPICK: Shell injection risk with unescaped input**
- **Tactic**: Security best practices
- **Issue**: `accountId` is interpolated into shell command without escaping
- **Location**: Line 80
```ts
`echo -n "${accountId}" | sha256sum | cut -c1-7`
```
- **Fix**: Sanitize input or use Node crypto module instead of shell commands

### 5. **NITPICK: Inconsistent context usage**
- **Tactic**: `args:input-context`
- **Issue**: `context` parameter destructured but only `.log` used; could extract upfront
- **Location**: Line 55
- **Fix**: Either use full context object capabilities or destructure: `{ log }: ContextLogTrail`

### 6. **NITPICK: Magic strings without constants**
- **Tactic**: Code maintainability
- **Issue**: Query states 'QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'SUCCEEDED' as magic strings
- **Location**: Lines 124, 129, 147, 153
- **Fix**: Define enum or const object for query states

### 7. **NITPICK: Comment doesn't explain "why" sufficiently**
- **Tactic**: `comment:discipline`
- **Issue**: Comment "skip if column name is undefined" explains what, not why it could be undefined
- **Location**: Line 195
- **Fix**: Explain why column name might be undefined (defensive programming for AWS API variance)

### 8. **NITPICK: Ambiguous variable name**
- **Tactic**: `name:ubiqlang`
- **Issue**: `resultsRaw` and `resultsData` use synonyms (raw vs data) instead of clear intent
- **Location**: Lines 169, 174
- **Fix**: Use `resultsJson` and `resultsParsed` or similar to clarify transformation

### 9. **NITPICK: Missing blank line after last statement in paragraph**
- **Tactic**: `flow:narrative`
- **Issue**: Line 166 log statement not followed by blank line before next paragraph
- **Location**: Line 166-168
- **Fix**: Add blank line after 166

### 10. **NITPICK: Function signature not async despite performing I/O**
- **Tactic**: Best practices for Node.js
- **Issue**: Function performs I/O but is synchronous, limiting composability
- **Location**: Line 53
- **Fix**: Make async and use proper async AWS calls (relates to BLOCKER #4)

## Summary

- **5 BLOCKERs** requiring immediate attention (mutation, missing guards, wrong error types, blocking I/O, non-idempotent)
- **10 NITPICKs** for code quality improvement (formatting, security, maintainability)

**Priority**: Address BLOCKERs 1-4 together by refactoring to async/await with immutable state management and proper error handling. BLOCKER 5 (idempotency) should be addressed with clear documentation if true idempotency is not feasible for this use case.
