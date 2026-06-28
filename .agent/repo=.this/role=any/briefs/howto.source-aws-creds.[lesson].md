# howto.source-aws-creds

## .what

source AWS credentials from keyrack in shell skills and TypeScript.

## .why

credentials must be explicitly fetched and exported to the current process.

---

## shell pattern

`rhx keyrack unlock` runs in a subprocess — env vars don't propagate back.

### .wrong

```bash
# 👎 unlock runs in subprocess, AWS_PROFILE never reaches this shell
rhx keyrack unlock --owner ehmpath --env test
aws lambda invoke ...  # fails: no credentials
```

### .right

```bash
# 👍 unlock validates session, get fetches value into this shell
rhx keyrack unlock --owner ehmpath --env "$ENV"
export AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value)
aws lambda invoke ...  # works
```

### .reference

see `.agent/repo=ghlitch/role=observer/skills/aws.cloudwatch.logs.query.sh` line ~200.

---

## typescript pattern

use `keyrack.source()` from `rhachet/keyrack` to hydrate env vars.

### .pattern

```typescript
import { keyrack } from 'rhachet/keyrack';

// source credentials into process.env
keyrack.source({ env: 'test', owner: 'ehmpath', mode: 'lenient' });

// now AWS_PROFILE is set
console.log(process.env.AWS_PROFILE);
```

### .modes

| mode | behavior |
|------|----------|
| `lenient` | warn if absent, continue |
| `strict` | throw if absent |

### .reference

see `jest.integration.env.ts` and `provision/aws.infra/account=demo/resources.ts`.
