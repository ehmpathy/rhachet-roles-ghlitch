/**
 * .what = gather performance context for a SQL query to enable tuning
 * .why = provides observed duration, execution plan, and schema context needed for optimization
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import { execSync } from 'child_process';
import { DomainLiteral } from 'domain-objects';
import { readFileSync } from 'fs';
import { BadRequestError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

const log = generateLogMethods();

class QueryExecutionResult
  extends DomainLiteral<QueryExecutionResult>
  implements QueryExecutionResult
{
  attemptNumber!: number;
  durationMs!: number;
  rowCount!: number;
  error?: string;
}

class QueryPerformanceStats
  extends DomainLiteral<QueryPerformanceStats>
  implements QueryPerformanceStats
{
  minDurationMs!: number;
  maxDurationMs!: number;
  avgDurationMs!: number;
  medianDurationMs!: number;
  totalExecutions!: number;
  successfulExecutions!: number;
}

class TableDependency
  extends DomainLiteral<TableDependency>
  implements TableDependency
{
  schemaName!: string;
  tableName!: string;
  createDdl!: string;
  indexes!: string[];
}

class PerformanceContext
  extends DomainLiteral<PerformanceContext>
  implements PerformanceContext
{
  queryName!: string;
  sqlQuery!: string;
  executionResults!: QueryExecutionResult[];
  performanceStats!: QueryPerformanceStats;
  explainAnalyze!: string;
  tableDependencies!: TableDependency[];
  summary!: string;
}

// npx tsx src/skills/diagnose/sqlQueryPerformance/gatherQueryPerformanceContext.ts --cluster-arn <arn> --secret-arn <arn> --sql-file <path>
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose:
      'gather performance context for SQL query via observed duration, explain analyze, and schema DDL',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input, context) => {
    context.log.info('🔍 gathering SQL query performance context...', {});

    // extract cli arguments
    const clusterArn =
      process.argv
        .find((arg) => arg.startsWith('--cluster-arn='))
        ?.split('=')[1] ||
      process.argv[process.argv.indexOf('--cluster-arn') + 1];
    const secretArn =
      process.argv
        .find((arg) => arg.startsWith('--secret-arn='))
        ?.split('=')[1] ||
      process.argv[process.argv.indexOf('--secret-arn') + 1];
    const sqlFile =
      process.argv
        .find((arg) => arg.startsWith('--sql-file='))
        ?.split('=')[1] || process.argv[process.argv.indexOf('--sql-file') + 1];
    const database =
      process.argv
        .find((arg) => arg.startsWith('--database='))
        ?.split('=')[1] ||
      process.argv[process.argv.indexOf('--database') + 1] ||
      'postgres';

    // validate required arguments
    if (!clusterArn)
      return BadRequestError.throw('--cluster-arn is required', {});
    if (!secretArn)
      return BadRequestError.throw('--secret-arn is required', {});
    if (!sqlFile) return BadRequestError.throw('--sql-file is required', {});

    // read SQL query from file
    const sqlQuery = readSqlQueryFromFile({ filePath: sqlFile }, context);
    const queryName = extractQueryName({ sqlQuery }, context);

    context.log.info(`📝 loaded query: ${queryName}`, { sqlFile });

    // step 1: execute query 5 times to measure observed duration
    context.log.info(
      '⏱️  step 1: executing query 5 times to measure duration...',
      {},
    );

    const executionResults = await executeQueryMultipleTimes(
      {
        clusterArn,
        secretArn,
        database,
        sqlQuery,
        iterations: 5,
      },
      context,
    );

    await context.out.write({
      name: 'execution_results.json',
      data: JSON.stringify(executionResults, null, 2),
    });

    // calculate performance statistics
    const performanceStats = calculatePerformanceStats(
      { executionResults },
      context,
    );

    context.log.info(
      `📊 avg duration: ${performanceStats.avgDurationMs.toFixed(
        2,
      )}ms (min: ${performanceStats.minDurationMs.toFixed(
        2,
      )}ms, max: ${performanceStats.maxDurationMs.toFixed(2)}ms)`,
      {},
    );

    // step 2: gather EXPLAIN ANALYZE output
    context.log.info('🔬 step 2: gathering EXPLAIN ANALYZE output...', {});

    const explainAnalyze = await executeExplainAnalyze(
      {
        clusterArn,
        secretArn,
        database,
        sqlQuery,
      },
      context,
    );

    await context.out.write({
      name: 'explain_analyze.txt',
      data: explainAnalyze,
    });

    // step 3: gather CREATE DDL for dependent tables
    context.log.info(
      '🏗️  step 3: gathering CREATE DDL for dependent schemas...',
      {},
    );

    const tableDependencies = await gatherTableDependencies(
      {
        clusterArn,
        secretArn,
        database,
        explainOutput: explainAnalyze,
      },
      context,
    );

    await context.out.write({
      name: 'table_dependencies.json',
      data: JSON.stringify(tableDependencies, null, 2),
    });

    // write individual DDL files
    for (const table of tableDependencies) {
      await context.out.write({
        name: `ddl/${table.schemaName}.${table.tableName}.sql`,
        data: table.createDdl,
      });

      // write index DDL if present
      if (table.indexes.length > 0) {
        await context.out.write({
          name: `ddl/${table.schemaName}.${table.tableName}.indexes.sql`,
          data: table.indexes.join('\n\n'),
        });
      }
    }

    // generate verbal summary
    const summary = generatePerformanceSummary(
      {
        queryName,
        performanceStats,
        tableDependencies,
      },
      context,
    );

    // assemble performance context report
    const report: PerformanceContext = {
      queryName,
      sqlQuery,
      executionResults,
      performanceStats,
      explainAnalyze,
      tableDependencies,
      summary,
    };

    // write final report
    await context.out.write({
      name: 'performance_context.json',
      data: JSON.stringify(report, null, 2),
    });

    // write summary report
    const summaryLines: string[] = [];
    summaryLines.push('🔍 SQL Query Performance Context Report\n');
    summaryLines.push(`Query: ${queryName}\n`);
    summaryLines.push(`Summary:\n  ${summary}\n`);
    summaryLines.push(`Performance Statistics:`);
    summaryLines.push(
      `  Average Duration: ${performanceStats.avgDurationMs.toFixed(2)}ms`,
    );
    summaryLines.push(
      `  Median Duration:  ${performanceStats.medianDurationMs.toFixed(2)}ms`,
    );
    summaryLines.push(
      `  Min Duration:     ${performanceStats.minDurationMs.toFixed(2)}ms`,
    );
    summaryLines.push(
      `  Max Duration:     ${performanceStats.maxDurationMs.toFixed(2)}ms`,
    );
    summaryLines.push(
      `  Success Rate:     ${performanceStats.successfulExecutions}/${performanceStats.totalExecutions}\n`,
    );
    summaryLines.push(
      `Table Dependencies: ${tableDependencies.length} tables\n`,
    );

    for (const table of tableDependencies) {
      summaryLines.push(
        `  - ${table.schemaName}.${table.tableName} (${table.indexes.length} indexes)`,
      );
    }

    await context.out.write({
      name: 'summary.txt',
      data: summaryLines.join('\n'),
    });

    context.log.info('✅ performance context gathering complete', {});

    return { report };
  },
);

// execute the command when run directly
// npx tsx src/skills/diagnose/sqlQueryPerformance/gatherQueryPerformanceContext.ts --cluster-arn <arn> --secret-arn <arn> --sql-file <path>
if (require.main === module) void command({});

// helper function to execute AWS RDS Data API commands
const execRdsData = withLogTrail(
  (input: string): string => {
    return execSync(input, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  },
  { name: 'execRdsData', log: { level: LogLevel.INFO } },
);

// helper function to parse JSON
const parseJson = <T>(input: string): T => {
  return JSON.parse(input);
};

/**
 * .what = read SQL query from file and strip comments
 * .why = loads query content for execution and analysis
 * .note = idempotent; read-only file operation
 */
const readSqlQueryFromFile = (
  input: { filePath: string },
  _context: ContextLogTrail,
): string => {
  // reject empty file path
  if (!input.filePath?.trim())
    return BadRequestError.throw('filePath is required', {
      filePath: input.filePath,
    });

  // read file contents
  const rawContent = readFileSync(input.filePath, 'utf-8');

  // strip single-line comments but preserve query structure
  const cleanedQuery = rawContent
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  return cleanedQuery;
};

/**
 * .what = extract query name from SQL comments or generate from first line
 * .why = provides human-readable identifier for the query being analyzed
 * .note = idempotent; pure function
 */
const extractQueryName = (
  input: { sqlQuery: string },
  _context: ContextLogTrail,
): string => {
  // look for query_name comment pattern
  const nameMatch = input.sqlQuery.match(/query_name\s*=\s*([^\n]+)/);
  if (nameMatch) return nameMatch[1].trim();

  // fallback to first meaningful SQL keyword
  const firstLine = input.sqlQuery
    .split('\n')
    .find((line) => line.trim().length > 0);

  if (firstLine?.trim().toUpperCase().startsWith('SELECT'))
    return 'select_query';
  if (firstLine?.trim().toUpperCase().startsWith('UPDATE'))
    return 'update_query';
  if (firstLine?.trim().toUpperCase().startsWith('INSERT'))
    return 'insert_query';
  if (firstLine?.trim().toUpperCase().startsWith('DELETE'))
    return 'delete_query';

  return 'unknown_query';
};

/**
 * .what = execute SQL query multiple times via RDS Data API to measure duration
 * .why = gathers observed performance metrics across multiple runs
 * .note = idempotent per iteration; each execution is independent
 */
const executeQueryMultipleTimes = async (
  input: {
    clusterArn: string;
    secretArn: string;
    database: string;
    sqlQuery: string;
    iterations: number;
  },
  context: ContextLogTrail,
): Promise<QueryExecutionResult[]> => {
  // reject invalid iteration count
  if (input.iterations <= 0 || input.iterations > 100)
    return BadRequestError.throw('iterations must be between 1 and 100', {
      iterations: input.iterations,
    });

  // execute query N times sequentially
  const results: QueryExecutionResult[] = [];

  for (let i = 0; i < input.iterations; i++) {
    const startTime = Date.now();
    let error: string | undefined;
    let rowCount = 0;

    try {
      // execute query via RDS Data API
      const response = execRdsData(
        `aws rds-data execute-statement ` +
          `--resource-arn "${input.clusterArn}" ` +
          `--secret-arn "${input.secretArn}" ` +
          `--database "${input.database}" ` +
          `--sql "${escapeSql(input.sqlQuery)}" ` +
          `--output json`,
        context,
      );

      // parse response to count rows
      const parsed = parseJson<{ records?: unknown[][] }>(response);
      rowCount = parsed.records?.length || 0;
    } catch (err) {
      error = String(err);
    }

    const durationMs = Date.now() - startTime;

    results.push(
      new QueryExecutionResult({
        attemptNumber: i + 1,
        durationMs,
        rowCount,
        error,
      }),
    );

    context.log.info(
      `  attempt ${i + 1}/${input.iterations}: ${durationMs}ms`,
      { rowCount, error },
    );
  }

  return results;
};

/**
 * .what = escape SQL query for safe shell argument passing
 * .why = prevents command injection and preserves query structure
 * .note = idempotent; pure function
 */
const escapeSql = (sql: string): string => {
  return sql.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
};

/**
 * .what = calculate statistical performance metrics from execution results
 * .why = provides quantitative summary of query performance characteristics
 * .note = idempotent; pure function with no side effects
 */
const calculatePerformanceStats = (
  input: { executionResults: QueryExecutionResult[] },
  _context: ContextLogTrail,
): QueryPerformanceStats => {
  const { executionResults } = input;

  // filter successful executions only
  const successfulResults = executionResults.filter((r) => !r.error);

  // bailfast if no successful executions
  if (successfulResults.length === 0) {
    return new QueryPerformanceStats({
      minDurationMs: 0,
      maxDurationMs: 0,
      avgDurationMs: 0,
      medianDurationMs: 0,
      totalExecutions: executionResults.length,
      successfulExecutions: 0,
    });
  }

  // extract durations
  const durations = successfulResults.map((r) => r.durationMs);

  // calculate statistics
  const minDurationMs = Math.min(...durations);
  const maxDurationMs = Math.max(...durations);
  const avgDurationMs =
    durations.reduce((sum, d) => sum + d, 0) / durations.length;

  // calculate median
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDurationMs =
    sortedDurations.length % 2 === 0
      ? (sortedDurations[sortedDurations.length / 2 - 1] +
          sortedDurations[sortedDurations.length / 2]) /
        2
      : sortedDurations[Math.floor(sortedDurations.length / 2)];

  return new QueryPerformanceStats({
    minDurationMs,
    maxDurationMs,
    avgDurationMs,
    medianDurationMs,
    totalExecutions: executionResults.length,
    successfulExecutions: successfulResults.length,
  });
};

/**
 * .what = execute EXPLAIN ANALYZE on query to gather execution plan
 * .why = provides detailed query planner insights and actual runtime statistics
 * .note = idempotent; read-only query analysis
 */
const executeExplainAnalyze = async (
  input: {
    clusterArn: string;
    secretArn: string;
    database: string;
    sqlQuery: string;
  },
  context: ContextLogTrail,
): Promise<string> => {
  // construct EXPLAIN ANALYZE query
  const explainQuery = `EXPLAIN (ANALYZE true, VERBOSE true, BUFFERS true, FORMAT json) ${input.sqlQuery}`;

  // execute via RDS Data API
  const response = execRdsData(
    `aws rds-data execute-statement ` +
      `--resource-arn "${input.clusterArn}" ` +
      `--secret-arn "${input.secretArn}" ` +
      `--database "${input.database}" ` +
      `--sql "${escapeSql(explainQuery)}" ` +
      `--output json`,
    context,
  );

  // parse response and extract EXPLAIN output
  const parsed = parseJson<{
    records?: Array<Array<{ stringValue?: string }>>;
  }>(response);

  // bailfast if no records returned
  if (!parsed.records || parsed.records.length === 0) {
    return BadRequestError.throw('EXPLAIN ANALYZE returned no results', {});
  }

  // extract string value from first record
  const explainJson = parsed.records[0]?.[0]?.stringValue || '[]';

  // format for readability
  const formatted = JSON.stringify(JSON.parse(explainJson), null, 2);

  return formatted;
};

/**
 * .what = gather table dependencies from EXPLAIN output and fetch CREATE DDL statements
 * .why = provides schema context needed for understanding query optimization opportunities
 * .note = idempotent; read-only schema introspection using actual query plan
 */
const gatherTableDependencies = async (
  input: {
    clusterArn: string;
    secretArn: string;
    database: string;
    explainOutput: string;
  },
  context: ContextLogTrail,
): Promise<TableDependency[]> => {
  // extract table names from EXPLAIN output
  const tableNames = extractTableNamesFromExplain(
    { explainOutput: input.explainOutput },
    context,
  );

  context.log.info(`  found ${tableNames.length} table dependencies`, {
    tableNames,
  });

  // fetch CREATE DDL for each table
  const dependencies: TableDependency[] = [];

  for (const { schemaName, tableName } of tableNames) {
    // fetch table DDL
    const createDdl = await fetchTableDdl(
      {
        clusterArn: input.clusterArn,
        secretArn: input.secretArn,
        database: input.database,
        schemaName,
        tableName,
      },
      context,
    );

    // fetch index DDL
    const indexes = await fetchTableIndexes(
      {
        clusterArn: input.clusterArn,
        secretArn: input.secretArn,
        database: input.database,
        schemaName,
        tableName,
      },
      context,
    );

    dependencies.push(
      new TableDependency({
        schemaName,
        tableName,
        createDdl,
        indexes,
      }),
    );
  }

  return dependencies;
};

/**
 * .what = extract table names from EXPLAIN JSON output by traversing plan tree
 * .why = identifies which tables need DDL introspection using actual query execution plan
 * .note = idempotent; pure function that recursively walks EXPLAIN plan tree
 */
const extractTableNamesFromExplain = (
  input: { explainOutput: string },
  _context: ContextLogTrail,
): Array<{ schemaName: string; tableName: string }> => {
  // parse EXPLAIN JSON output
  const explainPlan = parseJson<Array<{ Plan: Record<string, unknown> }>>(
    input.explainOutput,
  );

  // bailfast if no plan found
  if (!explainPlan || explainPlan.length === 0) return [];

  // collect unique table names
  const uniqueTables = new Set<string>();
  const tables: Array<{ schemaName: string; tableName: string }> = [];

  // recursively walk plan tree to find all relation names
  const walkPlanNode = (node: Record<string, unknown>) => {
    // extract relation name if present
    const relationName = node['Relation Name'];
    if (relationName) {
      const schemaName = node.Schema ? String(node.Schema) : 'public';
      const key = `${schemaName}.${String(relationName)}`;

      // add if not already seen
      if (!uniqueTables.has(key)) {
        uniqueTables.add(key);
        tables.push({ schemaName, tableName: String(relationName) });
      }
    }

    // recurse into Plans array for nested nodes
    const plans = node.Plans;
    if (Array.isArray(plans)) {
      for (const childPlan of plans) {
        walkPlanNode(childPlan as Record<string, unknown>);
      }
    }
  };

  // walk the plan tree starting from root
  const rootPlan = explainPlan[0]?.Plan;
  if (rootPlan) walkPlanNode(rootPlan);

  return tables;
};

/**
 * .what = fetch CREATE TABLE DDL for specified table from PostgreSQL
 * .why = provides schema definition needed for query optimization analysis
 * .note = idempotent; read-only schema query
 */
const fetchTableDdl = async (
  input: {
    clusterArn: string;
    secretArn: string;
    database: string;
    schemaName: string;
    tableName: string;
  },
  context: ContextLogTrail,
): Promise<string> => {
  // construct PostgreSQL query to get CREATE TABLE statement
  const ddlQuery = `
    SELECT
      'CREATE TABLE ' || schemaname || '.' || tablename || ' (' ||
      string_agg(
        column_name || ' ' || data_type ||
        CASE WHEN character_maximum_length IS NOT NULL
          THEN '(' || character_maximum_length || ')'
          ELSE ''
        END ||
        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
        ', '
      ) || ');' AS create_ddl
    FROM (
      SELECT
        c.table_schema AS schemaname,
        c.table_name AS tablename,
        c.column_name,
        c.data_type,
        c.character_maximum_length,
        c.is_nullable,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = '${input.schemaName}'
        AND c.table_name = '${input.tableName}'
      ORDER BY c.ordinal_position
    ) cols
    GROUP BY schemaname, tablename;
  `;

  // execute via RDS Data API
  const response = execRdsData(
    `aws rds-data execute-statement ` +
      `--resource-arn "${input.clusterArn}" ` +
      `--secret-arn "${input.secretArn}" ` +
      `--database "${input.database}" ` +
      `--sql "${escapeSql(ddlQuery)}" ` +
      `--output json`,
    context,
  );

  // parse response and extract DDL
  const parsed = parseJson<{
    records?: Array<Array<{ stringValue?: string }>>;
  }>(response);

  // bailfast if no records returned
  if (!parsed.records || parsed.records.length === 0) {
    context.log.warn(
      `  no DDL found for ${input.schemaName}.${input.tableName}`,
      {},
    );
    return `-- Table ${input.schemaName}.${input.tableName} not found`;
  }

  return parsed.records[0]?.[0]?.stringValue || '-- DDL unavailable';
};

/**
 * .what = fetch CREATE INDEX statements for specified table from PostgreSQL
 * .why = provides index definitions needed for query optimization analysis
 * .note = idempotent; read-only schema query
 */
const fetchTableIndexes = async (
  input: {
    clusterArn: string;
    secretArn: string;
    database: string;
    schemaName: string;
    tableName: string;
  },
  context: ContextLogTrail,
): Promise<string[]> => {
  // construct PostgreSQL query to get CREATE INDEX statements
  const indexQuery = `
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = '${input.schemaName}'
      AND tablename = '${input.tableName}'
    ORDER BY indexname;
  `;

  // execute via RDS Data API
  const response = execRdsData(
    `aws rds-data execute-statement ` +
      `--resource-arn "${input.clusterArn}" ` +
      `--secret-arn "${input.secretArn}" ` +
      `--database "${input.database}" ` +
      `--sql "${escapeSql(indexQuery)}" ` +
      `--output json`,
    context,
  );

  // parse response and extract index definitions
  const parsed = parseJson<{
    records?: Array<Array<{ stringValue?: string }>>;
  }>(response);

  // bailfast if no records returned
  if (!parsed.records || parsed.records.length === 0) {
    context.log.info(
      `  no indexes found for ${input.schemaName}.${input.tableName}`,
      {},
    );
    return [];
  }

  return parsed.records
    .map((row) => row[0]?.stringValue || '')
    .filter((ddl) => ddl.length > 0);
};

/**
 * .what = generate verbal summary of query performance characteristics
 * .why = provides human-readable insights about performance and schema context
 * .note = idempotent; pure function with no side effects
 */
const generatePerformanceSummary = (
  input: {
    queryName: string;
    performanceStats: QueryPerformanceStats;
    tableDependencies: TableDependency[];
  },
  _context: ContextLogTrail,
): string => {
  const { queryName, performanceStats, tableDependencies } = input;

  const parts: string[] = [];

  // describe execution success
  if (performanceStats.successfulExecutions === 0) {
    parts.push(
      `Query "${queryName}" failed all ${performanceStats.totalExecutions} execution attempts.`,
    );
    return parts.join(' ');
  }

  parts.push(
    `Query "${queryName}" executed successfully ${performanceStats.successfulExecutions} out of ${performanceStats.totalExecutions} times.`,
  );

  // describe performance characteristics
  parts.push(
    `Average execution time was ${performanceStats.avgDurationMs.toFixed(
      2,
    )}ms with a median of ${performanceStats.medianDurationMs.toFixed(2)}ms.`,
  );

  // describe variance
  const variance =
    performanceStats.maxDurationMs - performanceStats.minDurationMs;
  const variancePercent = (variance / performanceStats.avgDurationMs) * 100;

  if (variancePercent < 20) {
    parts.push('Performance was consistent across executions.');
  } else if (variancePercent < 50) {
    parts.push('Performance showed moderate variance across executions.');
  } else {
    parts.push(
      'Performance showed high variance, suggesting caching effects or load variability.',
    );
  }

  // describe schema context
  const totalIndexes = tableDependencies.reduce(
    (sum, t) => sum + t.indexes.length,
    0,
  );

  parts.push(
    `Query depends on ${tableDependencies.length} table(s) with ${totalIndexes} total index(es).`,
  );

  return parts.join(' ');
};
