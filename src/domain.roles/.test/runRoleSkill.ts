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
 * .what = the ambient environment, with every host-shaped variable removed
 *
 * .why  = it is the ONE sanctioned way a test builds an env, because a per-runner
 *         convention is exactly what drifted last time. the BASH_ENV delete lived in this
 *         harness and in two bespoke runners, and eight others went without — invisible
 *         until a host defined one of the shadowed names.
 *
 *         so both vectors live here together: a caller cannot pick up the credential
 *         scrub and forget the rc delete, because there is one call and it carries both.
 *         `hermetic.contract` grades every runner for this call by name.
 *
 * .note = BASH_ENV names a file a NON-interactive bash sources at startup, and this host
 *         has it set. proven by isolation — with the delete removed and `--norc` left in
 *         place, 7 cases redden; with the delete in place and `--norc` removed, all pass.
 *         `--noprofile --norc` closes the rc vectors left over, and is applied at the
 *         `spawnSync` itself, since it is an argument rather than an env.
 */
export const asEnvHermetic = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of ENV_VARS_HOST_SHAPED) delete env[name];
  delete env.BASH_ENV;
  return env;
};

/**
 * .what = an env with EVERY credential source closed — the ambient variables above, and
 *         the keyrack that lives under HOME
 *
 * .why  = a suite that also makes LIVE aws calls cannot take `asEnvHermetic` wholesale:
 *         its live cases need the very credentials that scrub removes. what it needs is
 *         this, on its absent-credential cases alone.
 *
 *         those cases used to drop the aws variables and leave HOME ambient, which closes
 *         only half the door. the skill then falls through to `rhx keyrack get`, which
 *         reads `$HOME/.rhachet` — a keyrack that is FILLED-BUT-LOCKED on a developer
 *         host and wholly ABSENT on a runner. so `aws.s3.list [case4]` recorded
 *         `status: locked 🔒` on a laptop and met `status: absent 🫧` in cicd.
 *
 * .how  = HOME is pointed at a temp dir, so the keyrack is deterministically absent and
 *         the case renders the same on either host. it also stops a suite reading the
 *         human's real home at all, which is the reason `runRoleSkill` has always pinned
 *         it (rule.require.hermetic-tests).
 *
 * .note = `absent`, not `locked`, is what this pins. `locked` would need a keyrack
 *         fixture staged under the temp HOME — worth doing when a case wants to grade the
 *         locked arm specifically, but these cases are named "credentials not unlocked"
 *         and absent satisfies that. the point is that ONE of the two is chosen and
 *         written down, rather than left to whichever host runs the suite.
 */
export const asEnvWithoutCredentials = (input: {
  home: string;
}): Record<string, string | undefined> => ({
  ...asEnvHermetic(),
  HOME: input.home,
});

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
  // the ambient set is scrubbed BEFORE the caller's overrides land, so `options.env`
  // remains the one way a case declares a credential or cicd state — and the default is
  // the same on a laptop and a runner.
  const env: Record<string, string | undefined> = {
    ...asEnvHermetic(),
    HOME: input.cwd,
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
  // the BASH_ENV vector that actually carried it is closed by `asEnvHermetic` above,
  // beside the credential scrub, so no caller can take one and skip the other.
  //
  // --noprofile --norc closes the rc vectors left over, on both levels. unlike the
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
