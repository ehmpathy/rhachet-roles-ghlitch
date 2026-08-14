import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = the harness every role's skill suite runs its skills through
 * .why  = it began under `deployer/skills/.test/`, because the deployer was the only role
 *         with a suite. the operator's `use.testdb` then reached across roles to import it
 *         (`../../deployer/skills/.test/runDeployerSkill`), and the observer suites need it
 *         too — so it is lifted to the common ancestor of every role that uses it
 *         (rule.prefer.most-common-denominator: lift on the SECOND use, not the tenth).
 *
 *         the stub bin moved with it. the stubs were never deployer-specific — `aws`, `npm`
 *         and `docker` are the same tools whichever role wraps them — they only lived there
 *         because that is where the first caller was.
 */

/**
 * .what = a PATH that holds the system tools a skill genuinely needs (git, bash) but
 *         NOT `rhx`
 * .why  = every skill reads its credentials through `rhx keyrack get ... || echo ""`.
 *         on a developer host that call may answer; in cicd it may not. that is a
 *         host-shaped fork, and a snapshot taken across it reddens on drift
 *         (rule.require.hermetic-tests).
 *
 *         a PATH held to the system directories closes the fork: `rhx` is absent, the
 *         `|| echo ""` catches it, and the skill takes its absent-credential path every
 *         time, on every host. that path is a real critipath — the one a human hits when
 *         their keyrack is locked — so this narrows determinism and does NOT narrow
 *         coverage.
 *
 *         `git` must stay reachable: the skills look their environment directory up from
 *         `git rev-parse --show-toplevel`, and an absent git would quietly collapse that
 *         to `.` and exercise a different code path than the one the case names.
 */
export const PATH_WITHOUT_RHX = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * .what = the ambient variables a skill BRANCHES on, which therefore fork its render by host
 *
 * .why  = PATH and the shell rc were only two of the three vectors. the third is the
 *         environment itself: ten skills gate their credential work on
 *         `[[ -z "${AWS_ACCESS_KEY_ID:-}" ]]`, and the prod gate in `uses._.check.sh`
 *         reads `[[ "${CI:-}" != "true" ]]`. a runner sets both; an sso laptop sets
 *         neither. so a snapshot recorded on a laptop pinned the absent-credential arm,
 *         and the same case took the OTHER arm in cicd and reddened
 *         (rule.require.hermetic-tests).
 *
 *         that is exactly what happened: eight suites passed locally and failed on the
 *         runner, and every one of the eight wraps a skill in the list this scrub covers.
 *
 * .how  = they are removed BEFORE `options.env` is applied, so the default is the
 *         deterministic absent-credential baseline and a case that WANTS a credential
 *         state declares it — which is the same shape `--auth` uses at the cli
 *         (rule.forbid.fallbacks: a declaration, never a sniff of the host).
 *
 * .note = the absent-credential arm is a real critipath, not a degraded one — it is what
 *         a human meets when their keyrack is locked — so this buys determinism at no
 *         cost in coverage, exactly as `PATH_WITHOUT_RHX` does.
 *
 * .note = the whole aws credential family goes, not only the one variable the skills
 *         branch on today. a scrub that lists only the proven-guilty leaves the next
 *         `AWS_SESSION_TOKEN` read to rediscover this the hard way — grade the class,
 *         never the instances.
 */
export const ENV_VARS_HOST_SHAPED = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'CI',
  'GITHUB_ACTIONS',
] as const;

/**
 * .what = the checked-in stub executables, and where they are staged from
 */
const STUB_BIN_SOURCE = join(__dirname, 'stub.bin');

/**
 * .what = stage the stub executables into a temp repo and yield a PATH that finds them
 *         FIRST, ahead of the system directories
 * .why  = every skill belays on an absent credential when `rhx` is off PATH, so no case
 *         ever reached the tool the skill wraps. that left each skill's tail — the part
 *         past the credential read, where the real work and most of the render live —
 *         unreachable, and therefore un-snapped.
 *
 *         these stubs answer the credential read and stand in for the wrapped tool, so
 *         those tails become reachable and their renders can be clamped.
 *
 * .note = the files are COPIED, then chmod'd in the temp repo. a symlink would put the
 *         exec bit on the repo's own asset, so a test run would mutate the checked-out
 *         tree — a hermeticity break in the opposite direction
 *         (rule.require.hermetic-tests). the copy is why this is not an adhoc
 *         re-implementation of a genTempDir feature: genTempDir clones and symlinks, but
 *         it does not set an exec bit, and an exec bit is the whole point here
 *         (rule.forbid.adhoc-gentempdir-reimpl).
 */
export const genStubBinPath = (input: { cwd: string }): string => {
  const target = join(input.cwd, '.stub.bin');
  mkdirSync(target, { recursive: true });

  for (const name of readdirSync(STUB_BIN_SOURCE)) {
    const at = join(target, name);
    copyFileSync(join(STUB_BIN_SOURCE, name), at);
    chmodSync(at, 0o755);
  }

  // the stubs go FIRST so they shadow any same-named tool a host happens to hold. a host
  // that has real terraform installed must still exercise the stub, or the snapshot is
  // host-shaped again — the exact fork PATH_WITHOUT_RHX exists to close.
  return `${target}:${PATH_WITHOUT_RHX}`;
};

/**
 * .what = run a role skill from a temp repo and capture both streams + exit code
 * .why  = exercises the real shell skill end-to-end against isolated state, no mocks
 *         (rule.forbid.integration.mocks)
 *
 * .note = spawnSync, never execSync. a skill may write a full tree to stdout AND exit
 *         non-zero — the gate child does exactly this — and execSync would throw one of
 *         the two away.
 *
 * .note = HOME is pinned to the temp repo so `~/.rhachet/...` global and org meter state
 *         lands there and never in the human's real home.
 */
export const runRoleSkill = (
  input: {
    // an ABSOLUTE path to the skill, so a caller in any role can reach its own
    skillPath: string;
    args: string;
    cwd: string;
  },
  // `options`, not `input` — these tune HOW the run is staged rather than WHAT is run,
  // the one place an optional is sanctioned (rule.require.input-options-pattern).
  options?: {
    // false keeps the TTY human-guard live; spawnSync has no TTY, so a grant would be
    // refused. defaults to true.
    asHuman?: boolean;
    // overrides applied over the ambient set — e.g. CI, or a narrowed PATH.
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string; exitCode: number } => {
  // the ambient set is scrubbed of every host-shaped variable BEFORE the caller's
  // overrides land, so `options.env` remains the one way a case declares a credential or
  // cicd state — and the default is the same on a laptop and a runner.
  // .note = `string | undefined`, never `Record<string, string>`: process.env values are
  //         optional, so the stricter annotation fails to typecheck (TS2322).
  const envAmbient: Record<string, string | undefined> = {
    ...process.env,
    HOME: input.cwd,
  };
  for (const name of ENV_VARS_HOST_SHAPED) delete envAmbient[name];

  const env: Record<string, string | undefined> = {
    ...envAmbient,
    ...(options?.env ?? {}),
  };
  if (options?.asHuman ?? true) env.__I_AM_HUMAN = 'true';

  // the host's shell rc must not load into a run. an rc file may define a FUNCTION or an
  // ALIAS that shadows a command, and both beat PATH outright — so a stub placed first on
  // PATH still loses to one. PATH alone cannot close that door
  // (rule.require.hermetic-tests).
  //
  // not hypothetical: this developer's `.bash_aliases` maps `npm` to `pnpm`, so
  // `npm run deploy:dev` inside deploy.sh reached a pnpm that PATH had (correctly)
  // excluded, and the run died `127: pnpm: command not found`. on a runner with no such
  // rc the same case would have passed — a host-shaped fork of exactly the kind
  // PATH_WITHOUT_RHX exists to prevent.
  //
  // BASH_ENV is the vector that actually carried it: it names a file a NON-interactive
  // bash sources at startup, and this host has it set. proven by isolation — with the
  // delete removed and --norc left in place, 7 cases redden; with the delete in place and
  // --norc removed, all pass.
  delete env.BASH_ENV;
  // --noprofile --norc closes the REMAINING rc vectors on both levels. unlike the
  // BASH_ENV delete above, these are not proven to carry weight on this host — they are
  // the canonical way to make a bash invocation hermetic, kept because the hazard is a
  // class (any rc-defined function or alias) rather than the one variable that happened
  // to carry it here. stated as defense, not as a proven fix, so a later reader does not
  // credit them with a repair they did not make.
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `bash --noprofile --norc "${input.skillPath}" ${input.args}`,
    ],
    { encoding: 'utf-8', cwd: input.cwd, env },
  );

  // status is the exit code; null only when the process was killed by a signal, which we
  // never expect here — fail loud rather than mask a signal death as a 0 or a 2
  // (rule.forbid.failhide).
  if (result.status === null)
    throw new Error(
      `skill ${input.skillPath} did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
};
