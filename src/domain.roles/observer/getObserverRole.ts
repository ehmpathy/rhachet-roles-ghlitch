import { Role } from 'rhachet';

/**
 * .what = the observer role definition
 * .why = defines briefs and skills for system observability
 */
export const ROLE_OBSERVER: Role = Role.build({
  slug: 'observer',
  name: 'Observer',
  purpose: 'see all that goes on in the system',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role observer',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
