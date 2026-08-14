/**
 * .what = assert every non-blank line of a ghlitch render is a mascot, an artifact header,
 *         or a tree item at one of the sanctioned depths
 *
 * .why  = the glyph-less stray is the defect this whole class of suite exists to catch, and
 *         no `toContain` can see it: each such assertion proves a line EXISTS, and none
 *         proves what the OTHER lines are. only an allowlist audit catches a line that
 *         belongs to no category at all
 *         (rule.require.nest-subskill-output-in-buckets, `.enforcement`).
 *
 * .why here = it lives at the role root because three roles now audit their renders with it
 *         (observer, deployer, operator). the audit is a property of the ghlitch render
 *         contract, which every role shares — not of any one role
 *         (rule.prefer.most-common-denominator).
 *
 * .note = the artifact glyph is a parameter because the roles differ (🔮 observer,
 *         ⛵ deployer, 🦺 operator) — the audit itself does not.
 */
export const expectNoStrayLines = (input: {
  out: string;
  artifact: string;
}): void => {
  const strays = input.out
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('🐈 '))
    .filter((line) => !line.startsWith(`${input.artifact} `))
    // the tree's own items, and one nest level below them
    .filter((line) => !/^ {3}[├└]─ /.test(line))
    .filter((line) => !/^ {6}[├└]─ /.test(line))
    .filter((line) => !/^ {6}│ {2}└─ /.test(line))
    .filter((line) => !/^ {9}└─ /.test(line))
    // a sub.bucket frame: its open/close carry no text, and its gutter carries the child's
    // own render, which is the CHILD's contract to keep — this audit grades one skill's
    // lines, so it stops at the gutter rather than reach through it
    .filter((line) => !/^ +[├└]─$/.test(line))
    .filter((line) => !/^ +│/.test(line));
  expect(strays).toEqual([]);
};
