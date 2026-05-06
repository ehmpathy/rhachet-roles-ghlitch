import { RoleRegistry } from 'rhachet';

import { ROLE_ALERTER } from './alerter/getAlerterRole';
import { ROLE_BUDGETER } from './budgeter/getBudgeterRole';
import { ROLE_DEPLOYER } from './deployer/getDeployerRole';
import { ROLE_DETECTIVE } from './detective/getDetectiveRole';
import { ROLE_HARDENER } from './hardener/getHardenerRole';
import { ROLE_OBSERVER } from './observer/getObserverRole';

/**
 * .what = returns the ghlitch registry of predefined roles
 * .why =
 *   - enables CLI or thread logic to load available roles
 *   - avoids dynamic mutation
 */
export const getRoleRegistry = (): RoleRegistry =>
  new RoleRegistry({
    slug: 'ghlitch',
    readme: { uri: `${__dirname}/readme.md` },
    roles: [
      ROLE_OBSERVER,
      ROLE_DEPLOYER,
      ROLE_DETECTIVE,
      ROLE_BUDGETER,
      ROLE_ALERTER,
      ROLE_HARDENER,
    ],
  });
