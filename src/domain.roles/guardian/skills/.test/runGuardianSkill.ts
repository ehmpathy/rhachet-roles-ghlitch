import { MalfunctionError } from 'helpful-errors';
import { genTempDir } from 'test-fns';

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  asEnvHermetic,
  PATH_WITHOUT_RHX,
  runRoleSkill,
} from '../../../.test/runRoleSkill';

/**
 * .what = the guardian-specific half of the skill harness
 * .why  = `PATH_WITHOUT_RHX`, `asEnvHermetic` and the runner itself live at the role root
 *         `src/domain.roles/.test/runRoleSkill`, shared across every role
 *         (rule.prefer.most-common-denominator). what stays here is guardian-only: the
 *         skill-dir hop, the route-kind token, and a stub `rhx` that answers the calls
 *         `security.habitat.redteam` makes.
 *
 *         a caller that wants `PATH_WITHOUT_RHX` imports it from the shared module
 *         directly — this file does not forward it (rule.forbid.barrel-exports).
 */

/**
 * .what = the guardian skills directory, derived from this file's own location
 * .why  = a suite under `skills/` and a module under `skills/.test/` sit one level apart;
 *         the hop is resolved once here rather than at every caller.
 */
const SKILL_DIR = join(__dirname, '..');

/**
 * .what = the redteam skill's shared shell module, the one source of its tokens
 */
export const REDTEAM_OUTPUT_SH = join(
  SKILL_DIR,
  'security.habitat.redteam',
  'output.sh',
);

/**
 * .what = run a guardian skill by bare filename, from a temp repo
 * .why  = the suite names its skill as `security.habitat.redteam.sh`, not as an absolute
 *         path; this resolves the hop so each caller does not. the skill reads its own
 *         `output.sh` / `init.sh` / `templates/` from the real repo (via BASH_SOURCE), and
 *         treats `cwd` as the habitat it sweeps — so the scaffold lands in the temp repo.
 */
export const runGuardianSkill = (
  input: {
    skill: string;
    args: string;
    cwd: string;
  },
  options?: {
    asHuman?: boolean;
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string; exitCode: number } =>
  runRoleSkill(
    {
      skillPath: join(SKILL_DIR, input.skill),
      args: input.args,
      cwd: input.cwd,
    },
    options,
  );

/**
 * .what = did a spawned child exit on its own, with a status to assert on?
 * .why  = a spawn that never ran (`error`), or a child a signal killed (`status` null), has no
 *         exit status; each runner halts on that, and this names the check once
 */
const didExitOnItsOwn = (
  run: SpawnSyncReturns<string>,
): run is SpawnSyncReturns<string> & { status: number } =>
  !run.error && run.status !== null;

/**
 * .what = run one shell expression with the redteam `output.sh` sourced first
 * .why  = the suite clamps the shell module's communicators and transformers directly
 *         (the scanner, the dispatch gate, the carry gate); one runner holds the hermetic
 *         env, the `--noprofile --norc` shell, and the source line, so no case re-spells them
 */
export const runSourcedBash = (input: {
  expression: string;
  stdin: string;
  env: Record<string, string>;
}): { stdout: string; stderr: string; status: number } => {
  // input.env spreads last on purpose: a case that breaks a tool must put its bin ahead on PATH
  const run = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `source "${REDTEAM_OUTPUT_SH}"; ${input.expression}`,
    ],
    {
      input: input.stdin,
      env: { ...asEnvHermetic(), PATH: PATH_WITHOUT_RHX, ...input.env },
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  // a spawn that never ran, or a shell a signal killed, has no exit status to assert on
  if (!didExitOnItsOwn(run))
    throw new MalfunctionError('the sourced bash run did not exit on its own', {
      expression: input.expression,
      error: run.error?.message ?? null,
      signal: run.signal,
      stderr: run.stderr,
      hint: 'a timeout (60s) or an overflow (16MiB) kills the shell; read stderr for the cause',
    });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
};

/**
 * .what = run a guardian skill with a terminal (a pty) on its stdin
 * .why  = the gates belay when stdin is a terminal (an operator forgot the pipe); every other
 *         runner hands the child a pipe, so only a real pty reaches that refusal. util-linux
 *         `script` stands up the pty; its output arrives via the pty, so stdout and stderr merge
 *         and line ends read `\r\n`, normalized here to `\n`.
 * .note = `script -e` exits with the child's code. a host with no util-linux `script` halts
 *         named, never a skip (rule.require.failfast)
 */
export const runGuardianSkillOnTerminal = (input: {
  skill: string;
  args: string;
  cwd: string;
}): { output: string; exitCode: number } => {
  const command = `bash --noprofile --norc "${join(SKILL_DIR, input.skill)}" ${input.args}`;
  const run = spawnSync('script', ['-qec', command, '/dev/null'], {
    cwd: input.cwd,
    env: { ...asEnvHermetic(), HOME: input.cwd, PATH: PATH_WITHOUT_RHX },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });

  // a host with no pty tool, or a run a signal killed, names its cause
  if (!didExitOnItsOwn(run))
    throw new MalfunctionError('the terminal run did not exit on its own', {
      command,
      error: run.error?.message ?? null,
      signal: run.signal,
      hint: 'the terminal clamp needs util-linux `script` on PATH (apt install util-linux)',
    });
  return {
    output: asLfLineEnds({ out: run.stdout }),
    exitCode: run.status,
  };
};

/**
 * .what = a text with each CRLF line end turned to LF
 * .why = a pty renders line ends as CRLF; the snapshots read LF, as a pipe run does
 */
const asLfLineEnds = (input: { out: string }): string =>
  input.out.split('\r\n').join('\n');

/**
 * .what = mask the guardian skills dir in a render, for a stable snapshot
 * .why  = a halt that names an install path prints the host's absolute checkout path; a
 *         snapshot of it would differ on every other machine (rule.require.hermetic-tests).
 *         a damaged skill copy's root is masked the same way, so both read `<skills>`
 */
export const maskSkillPath = (input: {
  out: string;
  skillRoot: string | null;
}): string =>
  [input.skillRoot, SKILL_DIR]
    .filter((root): root is string => root !== null)
    .reduce((out, root) => out.split(root).join('<skills>'), input.out);

/**
 * .what = the route-kind token, read as text from `output.sh`'s single source
 * .why  = the suite and the date mask both key on it; a hardcoded literal would let a
 *         rename of ROUTE_KIND desync the suite silently rather than redden it. a text read
 *         (no shell-out) keeps a module import free of side effects; each call reads fresh,
 *         so no shared state can go stale
 */
export const getRouteKind = (): string => {
  const source = readFileSync(REDTEAM_OUTPUT_SH, 'utf-8');
  const found = source.match(/^ROUTE_KIND="([^"]+)"$/m)?.[1];
  if (!found)
    throw new MalfunctionError('ROUTE_KIND is absent from the redteam output.sh', {
      path: REDTEAM_OUTPUT_SH,
      hint: 'output.sh must declare ROUTE_KIND="<token>" on its own line',
    });
  return found;
};

/**
 * .what = the checked-in guardian stub executables
 * .why  = the shared `stub.bin/rhx` answers only `keyrack get|unlock`; the redteam skill
 *         also calls `route.bind.get|set`, `radio.task.push`, and `route.stone.set`. this
 *         stub answers those, and belays loud on every other call — so a new rhx call
 *         cannot silently get an empty answer and take a wrong path (rule.forbid.failhide).
 */
const STUB_BIN_SOURCE = join(__dirname, 'stub.bin');

/**
 * .what = stage a fresh copy of the guardian stub executables, executable
 * .why  = genTempDir clones the stubs; the chmod is the one step it does not do. the
 *         checked-in `stub.bin/rhx` is mode 100644 (verify: `git ls-files -s .../stub.bin/rhx`),
 *         and git does not portably keep an exec bit across checkouts, so the stub cannot be
 *         trusted to arrive executable. each call stages its own copy, so a stub's state file
 *         (the bind slot) never leaks between cases.
 */
export const genGuardianStubBin = (): string => {
  const bin = genTempDir({ slug: 'guardian-stub-bin', clone: STUB_BIN_SOURCE });
  for (const name of readdirSync(bin)) chmodSync(join(bin, name), 0o755);
  return bin;
};

/**
 * .what = a PATH that finds a stub bin first, ahead of the system directories
 * .why  = a host with a real `rhx` installed must still exercise the stub, or the render
 *         is host-shaped
 */
export const asStubBinPath = (input: { bin: string }): string =>
  `${input.bin}:${PATH_WITHOUT_RHX}`;

/**
 * .what = stage the guardian stubs and yield the PATH that finds them first
 */
export const genGuardianStubBinPath = (): string =>
  asStubBinPath({ bin: genGuardianStubBin() });

/**
 * .what = a bin dir whose `<tool>` fails as a real error, for a PATH ahead of the system
 * .why  = the scanner, the route extract, the git probe, and the scaffold writes each tell a
 *         tool's real error apart from success; a broken tool on PATH drives that branch for
 *         real, no mock. with `failOn`, only a call whose argv holds that text breaks; with
 *         `failOnStdin`, only a call whose stdin holds it. every other call runs the real tool —
 *         so a case can break the one call it targets, even where two calls share their argv.
 * .note = with neither filter, every call breaks: the empty `failOn` text matches any argv.
 *         that is the whole-tool break (git, grep, cp) most cases want; pass a filter to keep
 *         the tool alive for its other calls
 * .note = `failOnCall` breaks only the Nth argv match (1-based): two reads that share their
 *         argv (a read, then its read-back) can each be broken alone
 */
export const genBrokenToolBin = (input: {
  tool: string;
  exitCode: number;
  failOn?: string;
  failOnStdin?: string;
  failOnCall?: number;
}): string => {
  const bin = join(genTempDir({ slug: `broken-${input.tool}` }), 'bin');
  mkdirSync(bin, { recursive: true });
  const realTool = getRealToolPath({ tool: input.tool });

  // seed the call count, so the ordinal stub reads a real file and a broken read fails loud
  if (input.failOnCall !== undefined) writeFileSync(join(bin, '.calls'), '0');

  // stage the stub
  writeFileSync(
    join(bin, input.tool),
    asBrokenToolStub({ ...input, realTool, countFile: join(bin, '.calls') }),
  );
  chmodSync(join(bin, input.tool), 0o755);
  return bin;
};

/**
 * .what = a bin dir whose `<tool>` runs a given bash body, for a PATH ahead of the system
 * .why  = some faults are no exit code: a tool that succeeds yet prints a lie (a clock with no
 *         date), or one that does its real work and then leaves a state the next write breaks
 *         on. the body says what the tool does; no mock, a real executable on PATH
 */
export const genScriptedToolBin = (input: {
  tool: string;
  body: string;
}): string => {
  const bin = join(genTempDir({ slug: `scripted-${input.tool}` }), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, input.tool),
    `#!/usr/bin/env bash\n${input.body}\n`,
  );
  chmodSync(join(bin, input.tool), 0o755);
  return bin;
};

/**
 * .what = the broken-tool stub for a filter: keyed on stdin when `failOnStdin` is given, else
 *         on argv (an absent `failOn` breaks every call)
 */
const asBrokenToolStub = (input: {
  tool: string;
  realTool: string;
  exitCode: number;
  failOn?: string;
  failOnStdin?: string;
  failOnCall?: number;
  countFile: string;
}): string => {
  if (input.failOnCall !== undefined)
    return asBrokenToolOnCallExecutable({
      tool: input.tool,
      realTool: input.realTool,
      exitCode: input.exitCode,
      failOn: input.failOn ?? '',
      failOnCall: input.failOnCall,
      countFile: input.countFile,
    });
  if (input.failOnStdin !== undefined)
    return asBrokenToolOnStdinExecutable({
      tool: input.tool,
      realTool: input.realTool,
      exitCode: input.exitCode,
      failOnStdin: input.failOnStdin,
    });
  return asBrokenToolExecutable({
    tool: input.tool,
    realTool: input.realTool,
    exitCode: input.exitCode,
    failOn: input.failOn ?? '',
  });
};

/**
 * .what = the absolute path of a real tool on the suite PATH
 * .why  = the broken-tool stub passes every non-target call to the real tool; a tool the
 *         suite PATH lacks halts here, named, rather than as a stub that breaks every call
 */
const getRealToolPath = (input: { tool: string }): string => {
  const run = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-c', 'command -v -- "$1"', 'bash', input.tool],
    {
      env: { ...asEnvHermetic(), PATH: PATH_WITHOUT_RHX },
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );

  // a spawn that never ran, or a shell a signal killed, names its cause, never a null read
  if (!didExitOnItsOwn(run))
    throw new MalfunctionError(`the lookup of ${input.tool} did not exit on its own`, {
      tool: input.tool,
      error: run.error?.message ?? null,
      signal: run.signal,
      hint: 'a timeout (10s) kills the lookup; check the suite PATH dirs',
    });
  const found = run.stdout.trim();
  if (!found)
    throw new MalfunctionError(`no real ${input.tool} on the suite PATH`, {
      tool: input.tool,
      hint: 'the broken-tool stub passes non-target calls to the real tool; install it',
    });
  return found;
};

/**
 * .what = a value as one posix single-quoted shell word
 * .why  = the stub's match text lands in a `case` glob; quoted, a `*`, `$`, or `"` in it
 *         matches itself, never a wider set of calls
 */
const asShellQuoted = (value: string): string =>
  `'${value.split("'").join(`'\\''`)}'`;

/**
 * .what = the broken-tool stub executable: a call whose argv holds `failOn` breaks with
 *         `exitCode`; every other call runs the real tool
 */
const asBrokenToolExecutable = (input: {
  tool: string;
  realTool: string;
  exitCode: number;
  failOn: string;
}): string =>
  [
    '#!/bin/sh',
    `case "$*" in *${asShellQuoted(input.failOn)}*) echo ${asShellQuoted(`${input.tool}: simulated break`)} >&2; exit ${input.exitCode} ;; esac`,
    `exec ${asShellQuoted(input.realTool)} "$@"`,
    '',
  ].join('\n');

/**
 * .what = the ordinal broken-tool stub: the Nth call whose argv holds `failOn` breaks with
 *         `exitCode`; every other call, matched or not, runs the real tool
 * .note = the count lives in a file beside the stub, so each spawned call reads the last one's
 */
const asBrokenToolOnCallExecutable = (input: {
  tool: string;
  realTool: string;
  exitCode: number;
  failOn: string;
  failOnCall: number;
  countFile: string;
}): string =>
  [
    '#!/bin/sh',
    `case "$*" in *${asShellQuoted(input.failOn)}*)`,
    `  calls=$(( $(cat ${asShellQuoted(input.countFile)}) + 1 ))`,
    `  echo "$calls" > ${asShellQuoted(input.countFile)}`,
    `  [ "$calls" -eq ${input.failOnCall} ] && { echo ${asShellQuoted(`${input.tool}: simulated break`)} >&2; exit ${input.exitCode}; } ;;`,
    'esac',
    `exec ${asShellQuoted(input.realTool)} "$@"`,
    '',
  ].join('\n');

/**
 * .what = the stdin-keyed broken-tool stub: a call whose stdin holds `failOnStdin` breaks with
 *         `exitCode`; every other call runs the real tool on the same stdin
 */
const asBrokenToolOnStdinExecutable = (input: {
  tool: string;
  realTool: string;
  exitCode: number;
  failOnStdin: string;
}): string =>
  [
    '#!/bin/sh',
    'held="$(mktemp)"',
    'cat > "$held"',
    `case "$(cat "$held")" in *${asShellQuoted(input.failOnStdin)}*) rm -f -- "$held"; echo ${asShellQuoted(`${input.tool}: simulated break`)} >&2; exit ${input.exitCode} ;; esac`,
    // the real tool runs as a child, never via exec, so the staged stdin file is removed on
    // every path and no call leaves debris in the temp dir
    'rc=0',
    `${asShellQuoted(input.realTool)} "$@" < "$held" || rc=$?`,
    'rm -f -- "$held"',
    'exit "$rc"',
    '',
  ].join('\n');

/**
 * .what = mask the ISO date in a redteam route path, for a stable snapshot
 * .why  = init derives its route slug from `date +%Y_%m_%d`, so the raw render carries
 *         today's date and a snapshot of it would redden tomorrow (rule.require.hermetic-tests).
 *         the mask keys on ROUTE_KIND, so a rename reddens at once rather than leave dates bare.
 * .note = ROUTE_KIND is read from output.sh once, at module load, so the mask itself is pure.
 */
const ROUTE_KIND_READ: string = getRouteKind();
export const maskRouteDate = (out: string): string =>
  out.replace(
    new RegExp(`v\\d{4}_\\d{2}_\\d{2}\\.${ROUTE_KIND_READ}`, 'g'),
    `v<date>.${ROUTE_KIND_READ}`,
  );
