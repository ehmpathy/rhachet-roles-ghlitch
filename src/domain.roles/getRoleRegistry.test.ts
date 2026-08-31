import { given, then, when } from 'test-fns';

import { getRoleRegistry } from './getRoleRegistry';

describe('getRoleRegistry', () => {
  given('the ghlitch role registry', () => {
    when('loaded', () => {
      const registry = getRoleRegistry();

      then('it matches the expected structure', () => {
        expect({
          slug: registry.slug,
          roleCount: registry.roles.length,
          roleSlugs: registry.roles.map((r) => r.slug).sort(),
        }).toMatchSnapshot();
      });

      then('it has the expected slug', () => {
        expect(registry.slug).toEqual('ghlitch');
      });

      then('it has observer role', () => {
        const observer = registry.roles.find((r) => r.slug === 'observer');
        expect(observer).toBeDefined();
        expect(observer?.name).toEqual('Observer');
      });

      then('it has operator role', () => {
        const operator = registry.roles.find((r) => r.slug === 'operator');
        expect(operator).toBeDefined();
        expect(operator?.name).toEqual('Operator');
      });

      then('it has deployer role', () => {
        const deployer = registry.roles.find((r) => r.slug === 'deployer');
        expect(deployer).toBeDefined();
        expect(deployer?.name).toEqual('Deployer');
      });

      then('it has guardian role', () => {
        const guardian = registry.roles.find((r) => r.slug === 'guardian');
        expect(guardian).toBeDefined();
        expect(guardian?.name).toEqual('Guardian');
      });

      then('it has all eight roles', () => {
        expect(registry.roles).toHaveLength(8);
        const slugs = registry.roles.map((r) => r.slug);
        expect(slugs).toContain('observer');
        expect(slugs).toContain('operator');
        expect(slugs).toContain('deployer');
        expect(slugs).toContain('detective');
        expect(slugs).toContain('budgeter');
        expect(slugs).toContain('alerter');
        expect(slugs).toContain('hardener');
        expect(slugs).toContain('guardian');
      });
    });
  });

  given('[edge] query for absent role', () => {
    when('searched by unknown slug', () => {
      const registry = getRoleRegistry();
      const notFound = registry.roles.find((r) => r.slug === 'nonexistent');

      then('it returns undefined', () => {
        // independent assertion alongside the snapshot, so a careless --resnap cannot silently
        // accept drift (rule.forbid.failhide — no snapshot-only verification).
        expect(notFound).toBeUndefined();
        expect(notFound).toMatchSnapshot();
      });
    });
  });
});
