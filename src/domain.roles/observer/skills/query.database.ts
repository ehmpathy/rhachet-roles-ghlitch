#!/usr/bin/env npx tsx

import { execSync } from 'child_process';
/**
 * 🔮 query.database — run readonly SQL queries against the database
 *
 * .what = executes SQL queries with readonly safety
 * .why  = enables quick database queries for debug
 *
 * safety: getDatabaseConnection({ mode: 'readonly' }) sets default_transaction_read_only=on
 *         PostgreSQL rejects any INSERT/UPDATE/DELETE/DROP at the driver level
 */
import path from 'path';

const main = async () => {
  // dynamic import from git root (allows use in any repo with getDatabaseConnection)
  const gitRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
  }).trim();
  const { getDatabaseConnection } = await import(
    path.join(gitRoot, 'src/utils/database/getDatabaseConnection')
  );

  // parse args
  const args = process.argv.slice(2);
  let sql = '';
  let format = 'table';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
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
    } else if (
      ['--env', '--limit', '--repo', '--role', '--skill'].includes(arg)
    ) {
      i++; // skip value
    } else if (arg === '--') {
      // skip separator
    }
  }

  // validate sql
  if (!sql) {
    console.error('🐈 belay that...');
    console.error('');
    console.error('🔮 query.database');
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
    console.error('🐈 caught it!');
    console.error('');
    console.error('🔮 query.database');
    console.error(`   └─ rows: ${result.rows.length}`);
  } finally {
    await dbConnection.end();
  }
};

main().catch((error) => {
  console.error('🐈 wet paws...');
  console.error('');
  console.error('🔮 query.database');
  console.error(`   └─ ${error.message}`);
  process.exit(1);
});
