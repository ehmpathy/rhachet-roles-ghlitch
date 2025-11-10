/**
 * .what = execute Athena query against S3 metadata tables using s3tables:// protocol
 * .why = enables analysis of object metadata, storage patterns, and cost optimization opportunities
 *
 * .how
 * - validates required inputs before executing expensive operations
 * - uses s3tables:// protocol to query Apache Iceberg tables directly
 * - automatically constructs table ARN from bucket/account info
 * - polls for query completion with configurable timeout using immutable state
 * - returns structured results with columns and rows
 *
 * .note = non-idempotent - creates new Athena query execution on each call
 * .note = consider implementing query result caching or deduplication for production use
 *
 * @example
 * ```typescript
 * const result = await queryS3MetadataByBucket({
 *   bucket: {
 *     source: { name: 'my-bucket' },
 *     metadata: { name: 'ghlitch-a1b2c3d-tables' }
 *   },
 *   query: 'SELECT key, size, storage_class FROM $TABLE WHERE size > 1000000',
 *   outputLocation: 's3://analysis-bucket/athena-results/',
 *   region: 'us-east-1'
 * }, context);
 * ```
 */
import { ContextLogTrail } from 'as-procedure';
import { exec } from 'child_process';
import { UnexpectedCodePathError, BadRequestError } from 'helpful-errors';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface S3MetadataQueryResult {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}

export interface S3MetadataQueryInput {
  bucket: {
    source: {
      name: string;
    };
    metadata: {
      name?: string;
    };
  };
  query: string;
  outputLocation: string;
  region?: string;
  accountId?: string;
  maxResults?: number;
  timeoutSeconds?: number;
}

// query execution states returned by AWS Athena
const QUERY_STATE = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export const queryS3MetadataByBucket = async (
  input: S3MetadataQueryInput,
  context: ContextLogTrail,
): Promise<S3MetadataQueryResult> => {
  const {
    bucket,
    query,
    outputLocation,
    maxResults = 1000,
    timeoutSeconds = 300,
  } = input;

  // reject if source bucket name missing
  if (!bucket?.source?.name)
    BadRequestError.throw('bucket.source.name is required', { bucket });

  // reject if query is empty
  if (!query?.trim()) BadRequestError.throw('query cannot be empty', { query });

  // reject if output location missing
  if (!outputLocation?.trim())
    BadRequestError.throw('outputLocation is required', { outputLocation });

  const sourceBucketName = bucket.source.name;

  // get aws account info from config or caller identity
  const regionResult = await execAsync(
    input.region ? `echo "${input.region}"` : 'aws configure get region',
  );
  const region = regionResult.stdout.trim();

  const accountIdResult = await execAsync(
    input.accountId
      ? `echo "${input.accountId}"`
      : 'aws sts get-caller-identity --query Account --output text',
  );
  const accountId = accountIdResult.stdout.trim();

  // calculate table bucket name from account id hash per observability blueprint
  const hashResult = await execAsync(
    `printf '%s' "${accountId}" | sha256sum | cut -c1-7`,
    { shell: '/bin/bash' },
  );
  const accountIdHash = hashResult.stdout.trim();

  const tablesBucketName =
    bucket.metadata.name || `ghlitch-${accountIdHash}-tables`;
  const tableName = `${sourceBucketName}-metadata`;

  // construct s3tables:// ARN for direct Iceberg querying
  const tableArn = `s3tables://arn:aws:s3tables:${region}:${accountId}:bucket/${tablesBucketName}/default/${tableName}`;

  context.log.info('starting Athena query for S3 metadata', {
    sourceBucketName,
    tableArn,
    region,
  });

  // replace $TABLE placeholder with full s3tables:// ARN
  const finalQuery = query.replace(/\$TABLE/g, `"${tableArn}"`);

  context.log.info('executing query', { query: finalQuery });

  // start query execution
  const startQueryParams = {
    QueryString: finalQuery,
    ResultConfiguration: {
      OutputLocation: outputLocation,
    },
  };

  const startQueryResult = await execAsync(
    `aws athena start-query-execution --cli-input-json '${JSON.stringify(
      startQueryParams,
    )}' --region ${region}`,
  );

  const { QueryExecutionId } = JSON.parse(startQueryResult.stdout.trim()) as {
    QueryExecutionId: string;
  };

  context.log.info('query started', { queryExecutionId: QueryExecutionId });

  // poll for query completion using immutable recursive approach
  const pollQueryExecution = async (attemptNumber: number): Promise<string> => {
    // halt if timeout exceeded
    if (attemptNumber > timeoutSeconds)
      UnexpectedCodePathError.throw('query timed out waiting for completion', {
        timeoutSeconds,
        queryExecutionId: QueryExecutionId,
      });

    const executionResult = await execAsync(
      `aws athena get-query-execution --query-execution-id ${QueryExecutionId} --region ${region}`,
    );

    const execution = JSON.parse(executionResult.stdout.trim()) as {
      QueryExecution: {
        Status: { State: string; StateChangeReason?: string };
      };
    };

    const queryState = execution.QueryExecution.Status.State;

    // halt if query failed
    if (
      queryState === QUERY_STATE.FAILED ||
      queryState === QUERY_STATE.CANCELLED
    ) {
      const reason =
        execution.QueryExecution.Status.StateChangeReason || 'Unknown error';
      UnexpectedCodePathError.throw(`query ${queryState.toLowerCase()}`, {
        reason,
        queryExecutionId: QueryExecutionId,
        state: queryState,
      });
    }

    // continue polling if still in progress
    if (
      queryState === QUERY_STATE.QUEUED ||
      queryState === QUERY_STATE.RUNNING
    ) {
      context.log.info('waiting for query to complete', {
        state: queryState,
        attempt: attemptNumber,
      });

      // wait 1 second before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return pollQueryExecution(attemptNumber + 1);
    }

    // return final state when complete
    return queryState;
  };

  const finalState = await pollQueryExecution(1);

  context.log.info('query completed, fetching results', { state: finalState });

  // get query results from athena
  const resultsJson = await execAsync(
    `aws athena get-query-results --query-execution-id ${QueryExecutionId} --max-results ${maxResults} --region ${region}`,
  );

  const resultsParsed = JSON.parse(resultsJson.stdout.trim()) as {
    ResultSet: {
      Rows: Array<{
        Data: Array<{ VarCharValue?: string }>;
      }>;
      ResultSetMetadata: {
        ColumnInfo: Array<{ Name: string }>;
      };
    };
  };

  // extract column names from metadata
  const columns = resultsParsed.ResultSet.ResultSetMetadata.ColumnInfo.map(
    (col) => col.Name,
  );

  // extract data rows, skipping header row, building immutably
  const rows = resultsParsed.ResultSet.Rows.slice(1).map((row) =>
    row.Data.reduce((rowData, cell, idx) => {
      const columnName = columns[idx];

      // skip if column index exceeds metadata definition
      if (!columnName) return rowData;

      const value = cell.VarCharValue;

      // preserve all values as strings to maintain precision for large numbers
      return {
        ...rowData,
        [columnName]: value !== undefined && value !== null ? value : null,
      };
    }, {} as Record<string, string | number | null>),
  );

  context.log.info('query results retrieved', {
    columns: columns.length,
    rows: rows.length,
  });

  return { columns, rows };
};
