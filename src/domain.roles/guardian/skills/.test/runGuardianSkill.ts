import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATH_WITHOUT_RHX, runRoleSkill } from '../../../.test/runRoleSkill';

/**
 * .what = the guardian-specific half of the skill harness
 * .why  = `PATH_WITHOUT_RHX`, `asEnvHermetic` and the runner itself live at the role root
 *         `src/domain.roles/.test/runRoleSkill`, shared across every role
 *         (rule.prefer.most-common-denominator). what stays here is genuinely
 *         guardian-only: the skill-dir hop, and a stub `rhx` that answers the one route
 *         probe `security.habitat.redteam --mode apply` makes.
 *
 *         a caller that wants `PATH_WITHOUT_RHX` imports it from the shared module
 *         directly — this file does NOT forward it (rule.forbid.barrel-exports).
 */

/**
 * .what = the guardian skills directory, derived from this file's own location
 * .why  = a suite under `skills/` and a helper under `skills/.test/` sit one level apart;
 *         the hop is resolved once here rather than at every caller.
 */
const SKILL_DIR = join(__dirname, '..');

/**
 * .what = run a guardian skill by bare filename, from a temp repo
 * .why  = the suite names its skill as `security.habitat.redteam.sh`, not as an absolute
 *         path; this resolves the hop so each caller does not. the skill reads its own
 *         `output.sh` / `init.sh` / `templates/` from the REAL repo (via BASH_SOURCE), and
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
 * .what = the checked-in guardian stub executables, and where they stage from
 * .why  = the shared `stub.bin/rhx` answers only `keyrack get|unlock`; the guardian skill's
 *         apply path also probes `rhx route.bind.get`. a guardian-local stub answers that
 *         one probe (empty = no route bound) so apply reaches its scaffold + honest-handoff
 *         branch, and belays loudly on every other call — so a NEW rhx call cannot silently
 *         get an empty answer and take a wrong path while a test claims it reached the
 *         scaffold (rule.forbid.failhide).
 */
const STUB_BIN_SOURCE = join(__dirname, 'stub.bin');

/**
 * .what = stage the guardian stub executables into a temp repo and yield a PATH that finds
 *         them FIRST, ahead of the system directories
 * .why  = the files are COPIED then chmod'd in the temp repo, never symlinked. the reason a
 *         chmod is GENUINELY required (not adhoc): the checked-in `stub.bin/rhx` is mode
 *         100644 — NON-executable (verify: `git ls-files -s .../stub.bin/rhx`). git does not
 *         portably preserve an exec bit across checkouts (a `core.fileMode=false` host, a
 *         windows clone), so the stub cannot be relied on to arrive executable. a symlink to
 *         a 0644 file yields a NON-executable `rhx` on PATH; the copy+chmod makes it
 *         executable at test time regardless of the recorded git mode. genTempDir offers
 *         clone + symlink, but NEITHER sets an exec bit — the exec bit is the whole point —
 *         so this stages a capability genTempDir does not provide, rather than re-implement
 *         one it does (rule.forbid.adhoc-gentempdir-reimpl). it mirrors the already-approved
 *         shared `runRoleSkill.genStubBinPath`, the same pattern one role up
 *         (rule.prefer.most-common-denominator).
 */
export const genGuardianStubBinPath = (input: { cwd: string }): string => {
  const target = join(input.cwd, '.stub.bin');
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(STUB_BIN_SOURCE)) {
    const at = join(target, name);
    copyFileSync(join(STUB_BIN_SOURCE, name), at);
    chmodSync(at, 0o755);
  }
  // the stubs go FIRST so they shadow any same-named tool a host happens to hold — a host
  // with a real `rhx` installed must still exercise the stub, or the render is host-shaped.
  return `${target}:${PATH_WITHOUT_RHX}`;
};

/**
 * .what = mask the ISO date in a guardian-redteam route path, for a stable snapshot
 * .why  = init.sh derives its route slug from `date +%Y_%m_%d`, so the raw render carries
 *         today's date and a snapshot of it would redden tomorrow (rule.require.hermetic-tests).
 *         the date is genuine output, not a defect — so it is masked to `<date>` rather than
 *         sliced away, which keeps the rest of the path (the `.guardian-redteam/` shape a
 *         reader checks) in the snapshot.
 */
export const maskRouteDate = (out: string): string =>
  out.replace(
    /v\d{4}_\d{2}_\d{2}\.guardian-redteam/g,
    'v<date>.guardian-redteam',
  );
