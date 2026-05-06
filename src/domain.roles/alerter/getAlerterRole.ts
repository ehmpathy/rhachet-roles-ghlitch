import { Role } from 'rhachet';

/**
 * .what = alerter role for alert signal-to-noise optimization
 * .why = ensure real defects alert while false positives stay silent
 */
export const ROLE_ALERTER: Role = Role.build({
  slug: 'alerter',
  name: 'Alerter',
  purpose: 'ensure real defects alert while false positives stay silent',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role alerter',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
