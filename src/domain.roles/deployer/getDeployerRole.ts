import { Role } from 'rhachet';

/**
 * .what = the deployer role definition
 * .why = defines briefs and skills for deployment operations
 */
export const ROLE_DEPLOYER: Role = Role.build({
  slug: 'deployer',
  name: 'Deployer',
  purpose: 'orchestrate and execute deployments safely',
  readme: { uri: `${__dirname}/readme.md` },
  boot: { uri: `${__dirname}/boot.yml` },
  traits: [],
  briefs: {
    dirs: { uri: `${__dirname}/briefs` },
  },
  skills: {
    dirs: { uri: `${__dirname}/skills` },
    refs: [],
  },
  inits: {
    dirs: { uri: `${__dirname}/inits` },
    exec: [],
  },
  hooks: {
    onBrain: {
      onBoot: [
        {
          command:
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role deployer',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
