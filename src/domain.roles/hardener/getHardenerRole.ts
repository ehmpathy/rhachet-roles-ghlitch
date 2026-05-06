import { Role } from 'rhachet';

/**
 * .what = hardener role for security vulnerability review
 * .why = protect systems from security threats and vulnerabilities
 */
export const ROLE_HARDENER: Role = Role.build({
  slug: 'hardener',
  name: 'Hardener',
  purpose: 'review for security vulnerabilities and harden systems',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role hardener',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
