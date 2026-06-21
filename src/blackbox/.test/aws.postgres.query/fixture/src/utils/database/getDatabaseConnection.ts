import { HelpfulError } from 'helpful-errors';
import pg, { Client, type QueryResult, type QueryResultRow } from 'pg';

// https://github.com/brianc/node-postgres/pull/353#issuecomment-283709264
pg.types.setTypeParser(20, (value) => parseInt(value, 10));
pg.types.setTypeParser(1700, (value) => parseFloat(value));

export interface DatabaseConnection {
  query: <Row extends QueryResultRow>(args: {
    sql: string;
    values?: unknown[];
  }) => Promise<QueryResult<Row>>;
  end: () => Promise<void>;
}

export class DatabaseQueryError extends HelpfulError {
  constructor({
    sql,
    values,
    caught,
  }: {
    sql: string;
    values?: unknown[];
    caught: Error;
  }) {
    const message = `
caught error on database query: ${caught.message}

sql:
  ${sql.trim()}

values:
  ${JSON.stringify(values)}
    `.trim();
    super(message, { sql, values, cause: caught });
  }
}

/**
 * .what = get database connection for ghlitch testdb
 * .why = enables aws.postgres.query skill to run queries
 *
 * .note = simple implementation for roles package test
 *         production services use sdk-config for credentials
 */
export const getDatabaseConnection = async (
  options: { mode?: 'readonly' | 'readwrite' } = {},
): Promise<DatabaseConnection> => {
  const { mode = 'readwrite' } = options;

  // connect to testdb with hardcoded values
  // production services use getConfig() for these
  const client = new Client({
    host: 'localhost',
    port: 7821,
    user: 'postgres',
    password: 'a-secure-password',
    database: 'ghlitch_testdb',
  });

  await client.connect();

  // set readonly mode if requested
  if (mode === 'readonly') {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');
  }

  return {
    query: ({ sql, values }: { sql: string; values?: unknown[] }) =>
      client.query(sql, values).catch((error) => {
        throw new DatabaseQueryError({ sql, values, caught: error });
      }),
    end: () => client.end(),
  };
};
