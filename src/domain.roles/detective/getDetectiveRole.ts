import { Role } from 'rhachet';

/**
 * .what = the detective role definition
 * .why = defines briefs and skills for diagnostics and investigations
 */
export const ROLE_DETECTIVE: Role = Role.build({
  slug: 'detective',
  name: 'Detective',
  purpose: 'diagnose issues and investigate system behavior',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role detective',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
