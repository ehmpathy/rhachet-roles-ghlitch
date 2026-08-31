import { readFileSync } from 'fs';
import { join } from 'path';
import { given, then, when } from 'test-fns';

import { getRoleRegistry } from './getRoleRegistry';

/**
 * .what = clamps that every registered role is discoverable in both human-readable role readmes
 * .why  = a newly registered role (like guardian) must not ship undiscoverable in the docs.
 *         this is a repo-wide registry concern, so it lives next to getRoleRegistry (its
 *         natural home), not nested under any single role's brief-invariants test
 *         (rule.require.single-responsibility).
 * .note = reads readme.md from disk, so it is an integration test, not a unit test
 *         (rule.forbid.unit.remote-boundaries). paths are built from __dirname, so the run
 *         is cwd-independent and hermetic.
 */

const repoRoot = join(__dirname, '..', '..');

describe('getRoleRegistry discoverability', () => {
  given('the ghlitch role registry', () => {
    const roleSlugs = getRoleRegistry().roles.map((role) => role.slug);
    [
      { label: 'root readme', path: join(repoRoot, 'readme.md') },
      {
        label: 'domain.roles readme',
        path: join(__dirname, 'readme.md'),
      },
    ].forEach((doc) => {
      when(`the ${doc.label} is read`, () => {
        const content = readFileSync(doc.path, 'utf-8').toLowerCase();
        roleSlugs.forEach((slug) => {
          then(`it lists the ${slug} role`, () => {
            expect(content).toContain(slug);
          });
        });
      });
    });
  });
});
