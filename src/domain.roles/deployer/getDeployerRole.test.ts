import { given, then, when } from 'test-fns';

import { ROLE_DEPLOYER } from './getDeployerRole';

describe('getDeployerRole', () => {
  given('the deployer role', () => {
    when('inspected', () => {
      then('it matches the expected structure', () => {
        expect({
          slug: ROLE_DEPLOYER.slug,
          name: ROLE_DEPLOYER.name,
          purpose: ROLE_DEPLOYER.purpose,
          hasSkillDirs: !!ROLE_DEPLOYER.skills?.dirs,
          hasBriefDirs: !!ROLE_DEPLOYER.briefs?.dirs,
          hasBoot: !!ROLE_DEPLOYER.boot?.uri,
          hasKeyrack: !!ROLE_DEPLOYER.keyrack?.uri,
        }).toMatchSnapshot();
      });

      then('it has the expected slug', () => {
        expect(ROLE_DEPLOYER.slug).toEqual('deployer');
      });

      then('it has the expected name', () => {
        expect(ROLE_DEPLOYER.name).toEqual('Deployer');
      });

      then('it has the expected purpose', () => {
        expect(ROLE_DEPLOYER.purpose).toEqual(
          'orchestrate and execute deployments safely',
        );
      });

      then('it has skill directories configured', () => {
        expect(ROLE_DEPLOYER.skills?.dirs).toBeDefined();
      });

      then('it has brief directories configured', () => {
        expect(ROLE_DEPLOYER.briefs?.dirs).toBeDefined();
      });

      then('it has boot configured', () => {
        expect(ROLE_DEPLOYER.boot?.uri).toContain('boot.yml');
      });
    });
  });

  given('[edge] optional properties', () => {
    when('keyrack is accessed', () => {
      then('it is absent (not configured for deployer)', () => {
        expect(ROLE_DEPLOYER.keyrack?.uri).toMatchSnapshot();
      });
    });
  });
});
