import { Role } from 'rhachet';

/**
 * .what = budgeter role for infrastructure cost visibility
 * .why = track costs to ensure stability and prevent surprise bills
 */
export const ROLE_BUDGETER: Role = Role.build({
  slug: 'budgeter',
  name: 'Budgeter',
  purpose: 'track infrastructure costs to ensure stability',
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
            './node_modules/.bin/rhachet roles boot --repo ghlitch --role budgeter',
          timeout: 'PT60S',
        },
      ],
      onTool: [],
      onStop: [],
    },
  },
});
