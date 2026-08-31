import { given, then, when } from 'test-fns';

import { ROLE_GUARDIAN } from './getGuardianRole';

describe('getGuardianRole', () => {
  given('the guardian role', () => {
    when('inspected', () => {
      then('it matches the expected structure', () => {
        expect({
          slug: ROLE_GUARDIAN.slug,
          name: ROLE_GUARDIAN.name,
          purpose: ROLE_GUARDIAN.purpose,
          hasSkillDirs: !!ROLE_GUARDIAN.skills?.dirs,
          hasBriefDirs: !!ROLE_GUARDIAN.briefs?.dirs,
          hasBoot: !!ROLE_GUARDIAN.boot?.uri,
        }).toMatchSnapshot();
      });

      then('it has the expected slug', () => {
        expect(ROLE_GUARDIAN.slug).toEqual('guardian');
      });

      then('it has the expected name', () => {
        expect(ROLE_GUARDIAN.name).toEqual('Guardian');
      });

      then('it has brief directories configured', () => {
        expect(ROLE_GUARDIAN.briefs?.dirs).toBeDefined();
      });

      then('it has boot configured', () => {
        expect(ROLE_GUARDIAN.boot?.uri).toContain('boot.yml');
      });
    });
  });

  // regression guard: the ROLE_GUARDIAN purpose string is snapshot-only above, so a careless resnap
  // could accept re-inflated capability language — this asserts it stays inventory-framed, no answer
  // claim. lives here (next to the purpose snapshot) rather than in the guardian briefs-invariants
  // test, where it was a scope-leak (rule.require.single-responsibility).
  given('the guardian role purpose language', () => {
    when('the ROLE_GUARDIAN purpose is read', () => {
      then(
        'it stays inventory-framed with no answer-surface over-claim',
        () => {
          expect(ROLE_GUARDIAN.purpose).toContain('trace');
          expect(ROLE_GUARDIAN.purpose.toLowerCase()).not.toContain('answer');
        },
      );
    });
  });

  given('[edge] minimal contract surface', () => {
    when('only identity fields are extracted', () => {
      then('it matches the expected minimal structure', () => {
        // independent assertions alongside the snapshot, so a careless --resnap cannot silently
        // accept drift (rule.forbid.failhide — no snapshot-only verification).
        expect(ROLE_GUARDIAN.slug).toEqual('guardian');
        expect(ROLE_GUARDIAN.name).toEqual('Guardian');
        expect({
          slug: ROLE_GUARDIAN.slug,
          name: ROLE_GUARDIAN.name,
        }).toMatchSnapshot();
      });
    });
  });
});
