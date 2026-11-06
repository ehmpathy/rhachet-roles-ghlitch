# F45 — adopt the rhachet 1.50.1 bump in this tree, and ship it with this route

## .the fork
the director ruled the bump a driver-set act: settle it here, adopt or restore, by the driver's
judgment.

- (a) adopt: make the build and every suite pass under 1.50.1
- (b) restore: put `package.json` + `pnpm-lock.yaml` back to head (rhachet 1.48.0)

## .taken, why
(a). this route needs the bump: `.route/v2026_11_01.package.install/` installed
`rhachet-brains-openrouter` because the review guard's l1 lanes run on openrouter, and that brain
registers only with its provider installed. a restore pulls the provider out from under the guard
that grades this route.

the cost of (a) was three reds, each a fix at its cause: eight self-boot onBoot hooks dropped, three
keyrack-tip snapshots resnapped, the run-banner mask taught npm's config warn. every suite green
under 1.50.1 (integration 1701, acceptance 46, unit 53).

## .rework
clean. a restore is a lockfile revert plus three snapshot reverts and eight one-line hook adds;
no caller depends on the hook or the tip text.

## .confidence
85%. the 15% is whether the onBoot hook removal reads right to a council that weighs a role's boot
on rhachet <1.50: no consumer pins below 1.50 today, and the package's peer range is the place to
state it if one does.

## .where
- `src/domain.roles/*/get*Role.ts` (eight onBoot hooks)
- `src/domain.roles/deployer/skills/.test/maskRunnerBanner.ts` + its unit suite `[case4]`
- `src/domain.roles/observer/skills/__snapshots__/` (three keyrack tips)
- `5.3.verification.yield.md` § tests executed

## .verdict
ruled by the director: option 2, the call delegated to the driver. taken (a).
