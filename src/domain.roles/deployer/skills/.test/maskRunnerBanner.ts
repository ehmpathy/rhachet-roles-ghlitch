/**
 * .what = strip the package manager's run banner, envelope included, from a stdout
 *
 * .why  = the banner is the RUNNER's chrome, never the skill's output, and its shape
 *         differs by package manager:
 *
 *           npm                                    pnpm
 *           <blank>                                <dim>$ node provision/schema/plan.js</dim>
 *           > svc-test@0.0.0 provision:schema:plan
 *           > node provision/schema/plan.js
 *           <blank>
 *
 *         which one a run lands on depends on the HOST, not on the skill: a dotfile that
 *         redirects `npm` to `pnpm` is common, and this developer has one. so a snapshot
 *         that keeps either shape is host-shaped by construction
 *         (rule.require.hermetic-tests).
 *
 * .why REWRITTEN = the first cut anchored on `\n> svc-test@`, which failed twice over.
 *
 *         it assumed "pnpm emits no banner at all" — it emits a dim `$ <command>` line,
 *         so on a pnpm host the mask never fired and the ANSI codes went straight into
 *         the recorded bytes.
 *
 *         and it anchored the match to a line START, which held only while the schema
 *         payload ran at column 0. once that payload was framed in a bucket, every line
 *         carried a `   │  ` gutter, the anchor could not reach, and the mask silently
 *         stopped firing on BOTH managers. a mask that quietly no-ops is a failhide
 *         (rule.forbid.failhide) — hence the collocated unit suite that pins each shape.
 *
 * .how  = it grades a line by its CONTENT, with any tree gutter and ANSI stripped first,
 *         so it reads the same whether the payload is framed or bare. the banner lines
 *         are dropped, then any run of blank lines the removal left behind is collapsed
 *         to one — which is what makes npm's two-line-plus-blank and pnpm's one-line
 *         forms land on identical bytes.
 *
 * .note = this does NOT weaken the proof. the forwarded content is pinned BY VALUE by kin
 *         asserts in the collocated suite — the no-op marker the workflow greps, and the
 *         unique per-run token that exists nowhere in the skill. the snapshot's job is the
 *         visual vibecheck of the skill's OWN frame around them, which is what is left.
 *
 * .note = lives under .test/ because it is a test asset, never a skill. tsconfig.build
 *         excludes both `.test/` and `skills/**\/*.ts`, so it never ships to consumers.
 */

/**
 * .what = a line's content, with any tree gutter and ANSI styling removed
 * .why  = the same banner reads `> node x.js` at column 0 and `   │  > node x.js` inside a
 *         bucket. the grader must see one thing, not two.
 */
const asLineContent = (line: string): string =>
  line
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars by definition
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^[\s│]*/, '');

/**
 * .what = true when a line carries no content — a blank, or a bucket gutter alone
 */
const isLineEmpty = (line: string): boolean => asLineContent(line) === '';

export const maskRunnerBanner = (stdout: string): string => {
  const lines = stdout.split('\n');
  const content = lines.map(asLineContent);
  const dropped = new Set<number>();

  for (let at = 0; at < lines.length; at += 1) {
    // npm's banner is TWO lines: a `> <pkg>@<ver> <name>` header, then the command it
    // runs. only the header is distinctive, so the command line is dropped on the
    // strength of the header directly above it — never on its own, which keeps a `> `
    // the skill itself might print safe.
    const isNpmHeader = /^> \S+@\S+\s/.test(content[at] ?? '');
    const isNpmCommand = /^> \S/.test(content[at + 1] ?? '');
    if (isNpmHeader && isNpmCommand) {
      dropped.add(at).add(at + 1);
      // npm closes its banner with a blank line; pnpm emits none. that blank is the
      // runner's chrome too, so it goes with the banner it belongs to — which is what
      // lands the two managers on identical bytes.
      //
      // only the one BELOW. npm emits no blank above its header when its output is
      // piped, as it is here, so the blank above is the bucket frame's own spacer — and
      // the two are indistinguishable once both wear the gutter. an earlier cut dropped
      // it and silently ate the frame's spacer out of three snapshots.
      if (isLineEmpty(lines[at + 2] ?? 'x')) dropped.add(at + 2);
      continue;
    }

    // pnpm's whole banner is this one line, and it carries no envelope
    if (/^\$ \S/.test(content[at] ?? '')) dropped.add(at);
  }

  return lines.filter((_, at) => !dropped.has(at)).join('\n');
};
