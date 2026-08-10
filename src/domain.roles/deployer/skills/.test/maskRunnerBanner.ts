/**
 * .what = strip the package manager's run banner, envelope included, from a stdout
 * .why  = the banner is the RUNNER's chrome, never the skill's output, and its shape
 *         differs by host: npm emits
 *
 *           <blank>
 *           > svc-test@0.0.0 provision:schema:plan
 *           > node provision/schema/plan.js
 *           <blank>
 *
 *         while pnpm emits no banner at all — and which one `npm run` lands on depends
 *         on the host (a shell that redirects npm→pnpm when no package-lock.json is
 *         present is a common dotfile).
 *
 *         the blank lines are the subtle half. an earlier mask consumed the two TEXT
 *         lines but not the whitespace envelope around them, so a pnpm host rendered
 *         zero blank lines and an npm host rendered two — a snapshot that passed
 *         locally and reddened in cicd. the `\n+` on both sides closes that gap
 *         (rule.require.hermetic-tests).
 *
 *         this does NOT weaken the proof. the forwarded content is pinned BY VALUE by
 *         kin asserts in the collocated suite — the no-op marker the workflow greps,
 *         and the unique per-run token that exists nowhere in the skill. the
 *         snapshot's job is the visual vibecheck of the skill's OWN frame around them,
 *         which is what is left.
 *
 *         it is anchored to the banner's distinctive `> svc-test@` / `> node ` pair, so
 *         it can never swallow a blank line the skill itself printed.
 *
 * .note = lives under .test/ because it is a test asset, never a skill. tsconfig.build
 *         excludes both `.test/` and `skills/**\/*.ts`, so it never ships to consumers.
 */
export const maskRunnerBanner = (stdout: string): string =>
  stdout.replace(/\n+> svc-test@[^\n]*\n> node [^\n]*\n+/g, '\n');
