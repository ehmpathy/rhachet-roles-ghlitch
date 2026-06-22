#!/usr/bin/env npx tsx

import { execSync } from 'node:child_process';
/**
 * 🔮 aws.postgres.query — run readonly SQL queries against the database
 *
 * .what = executes SQL queries with readonly safety
 * .why  = enables quick database queries for debug
 *
 * safety: getDatabaseConnection({ mode: 'readonly' }) sets default_transaction_read_only=on
 *         PostgreSQL rejects any INSERT/UPDATE/DELETE/DROP at the driver level
 */
import path from 'node:path';

const main = async (): Promise<void> => {
  // dynamic import from git root (allows use in any repo with getDatabaseConnection)
  const gitRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
  }).trim();
  const { getDatabaseConnection } = await import(
    path.join(gitRoot, 'src/utils/database/getDatabaseConnection')
  );

  // parse args (shell already sets STAGE env var)
  const args = process.argv.slice(2);
  let sql = '';
  let format = 'table';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--sql') {
      const value = args[++i];
      if (value === '@stdin') {
        // read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        sql = Buffer.concat(chunks).toString('utf-8').trim();
      } else {
        sql = value ?? '';
      }
    } else if (arg === '--format') {
      format = args[++i] ?? 'table';
    } else if (arg.startsWith('--')) {
      i++; // skip unknown flag value
    } else if (arg === '--') {
      // skip separator
    }
  }

  // validate sql
  if (!sql) {
    console.error('🐈 belay that...');
    console.error('');
    console.error('🔮 aws.postgres.query');
    console.error('   └─ absent required arg: --sql');
    process.exit(2);
  }

  // connect to database in readonly mode
  const dbConnection = await getDatabaseConnection({ mode: 'readonly' });

  try {
    const result = await dbConnection.query({ sql });

    // output results
    if (format === 'json') {
      console.log(JSON.stringify(result.rows, null, 2));
    } else if (format === 'csv') {
      if (result.rows.length > 0) {
        const headers = Object.keys(result.rows[0]);
        console.log(headers.join(','));
        for (const row of result.rows) {
          console.log(
            headers.map((h) => JSON.stringify(row[h] ?? '')).join(','),
          );
        }
      }
    } else {
      // table format
      if (result.rows.length > 0) {
        console.table(result.rows);
      } else {
        console.log('(0 rows)');
      }
    }

    console.error('');
    console.error('🐈 smooth sailin!');
    console.error('');
    console.error('🔮 aws.postgres.query');
    console.error(`   └─ rows: ${result.rows.length}`);
  } finally {
    await dbConnection.end();
  }
};

main().catch((error) => {
  console.error('🐈 wet paws...');
  console.error('');
  console.error('🔮 aws.postgres.query');
  // handle AggregateError (e.g., connection refused)
  if (error?.errors?.length) {
    const firstError = error.errors[0];
    console.error(
      `   └─ ${firstError.message || firstError.code || 'connection error'}`,
    );
    const hint =
      process.env.ACCESS === 'test' ? 'rhx use.testdb' : 'rhx use.rds.capacity';
    console.error(`   └─ hint: ${hint}`);
  } else {
    const errorMessage =
      error instanceof Error
        ? error.message || error.toString()
        : String(error) || 'unknown error';
    console.error(`   └─ ${errorMessage}`);
  }
  process.exit(1);
});
