import { given, then, when } from 'test-fns';

import { ROLE_OBSERVER } from './getObserverRole';

describe('getObserverRole', () => {
  given('the observer role', () => {
    when('inspected', () => {
      then('it matches the expected structure', () => {
        expect({
          slug: ROLE_OBSERVER.slug,
          name: ROLE_OBSERVER.name,
          purpose: ROLE_OBSERVER.purpose,
          hasSkillDirs: !!ROLE_OBSERVER.skills?.dirs,
          hasBriefDirs: !!ROLE_OBSERVER.briefs?.dirs,
          hasBoot: !!ROLE_OBSERVER.boot?.uri,
          hasKeyrack: !!ROLE_OBSERVER.keyrack?.uri,
        }).toMatchSnapshot();
      });

      then('it has the expected slug', () => {
        expect(ROLE_OBSERVER.slug).toEqual('observer');
      });

      then('it has the expected name', () => {
        expect(ROLE_OBSERVER.name).toEqual('Observer');
      });

      then('it has the expected purpose', () => {
        expect(ROLE_OBSERVER.purpose).toEqual(
          'see all that goes on in the system',
        );
      });

      then('it has skill directories configured', () => {
        expect(ROLE_OBSERVER.skills?.dirs).toBeDefined();
      });

      then('it has brief directories configured', () => {
        expect(ROLE_OBSERVER.briefs?.dirs).toBeDefined();
      });

      then('it has keyrack configured', () => {
        expect(ROLE_OBSERVER.keyrack?.uri).toContain('keyrack.yml');
      });

      then('it has boot configured', () => {
        expect(ROLE_OBSERVER.boot?.uri).toContain('boot.yml');
      });
    });
  });

  given('[edge] minimal contract surface', () => {
    when('only identity fields are extracted', () => {
      then('it matches the expected minimal structure', () => {
        expect({
          slug: ROLE_OBSERVER.slug,
          name: ROLE_OBSERVER.name,
        }).toMatchSnapshot();
      });
    });
  });
});
