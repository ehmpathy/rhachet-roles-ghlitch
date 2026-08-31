import { Role } from 'rhachet';

/**
 * .what = the guardian role definition
 * .why = an active watchguard for cyber health — traces cited causal chains
 *        from an exposure to its observable harm. ships the cited inventory of
 *        the hazard, its elimination, and its detection; the answer-router that
 *        navigates a plain question to the brief that answers it is a planned
 *        follow-on
 */
export const ROLE_GUARDIAN: Role = Role.build({
  slug: 'guardian',
  name: 'Guardian',
  purpose:
    'watchguard cyber health — trace cited hazards, eliminations, and detections',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role guardian',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
