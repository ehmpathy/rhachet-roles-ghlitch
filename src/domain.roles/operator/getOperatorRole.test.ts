import { given, then, when } from 'test-fns';

import { ROLE_OPERATOR } from './getOperatorRole';

describe('getOperatorRole', () => {
  given('the operator role', () => {
    when('inspected', () => {
      then('it matches the expected structure', () => {
        expect({
          slug: ROLE_OPERATOR.slug,
          name: ROLE_OPERATOR.name,
          purpose: ROLE_OPERATOR.purpose,
          hasSkillDirs: !!ROLE_OPERATOR.skills?.dirs,
          hasBriefDirs: !!ROLE_OPERATOR.briefs?.dirs,
          hasBoot: !!ROLE_OPERATOR.boot?.uri,
          hasKeyrack: !!ROLE_OPERATOR.keyrack?.uri,
        }).toMatchSnapshot();
      });

      then('it has the expected slug', () => {
        expect(ROLE_OPERATOR.slug).toEqual('operator');
      });

      then('it has the expected name', () => {
        expect(ROLE_OPERATOR.name).toEqual('Operator');
      });

      then('it has the expected purpose', () => {
        expect(ROLE_OPERATOR.purpose).toEqual('operational support');
      });

      then('it has skill directories configured', () => {
        expect(ROLE_OPERATOR.skills?.dirs).toBeDefined();
      });

      then('it has brief directories configured', () => {
        expect(ROLE_OPERATOR.briefs?.dirs).toBeDefined();
      });

      then('it has keyrack configured', () => {
        expect(ROLE_OPERATOR.keyrack?.uri).toContain('keyrack.yml');
      });

      then('it has boot configured', () => {
        expect(ROLE_OPERATOR.boot?.uri).toContain('boot.yml');
      });
    });
  });

  given('[edge] minimal contract surface', () => {
    when('only identity fields are extracted', () => {
      then('it matches the expected minimal structure', () => {
        expect({
          slug: ROLE_OPERATOR.slug,
          name: ROLE_OPERATOR.name,
        }).toMatchSnapshot();
      });
    });
  });
});
