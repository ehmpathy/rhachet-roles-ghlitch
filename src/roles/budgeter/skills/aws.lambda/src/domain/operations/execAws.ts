/**
 * .what = execute AWS CLI commands with logging
 * .why = provides a consistent way to run AWS CLI commands with traceability
 */
import { withLogTrail, LogLevel } from 'as-procedure';
import { execSync } from 'child_process';

export const execAws = withLogTrail(
  (input: string): string => {
    return execSync(input, { encoding: 'utf-8' }).trim();
  },
  { name: 'execAws', log: { level: LogLevel.INFO } },
);
