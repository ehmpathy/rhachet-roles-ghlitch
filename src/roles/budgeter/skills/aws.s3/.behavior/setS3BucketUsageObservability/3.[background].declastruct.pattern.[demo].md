# .brief.demo = declastruct pattern, implemented for the stripe sdk

Use the declastruct pattern whenever we need to construct and control remote resources. Each remote resource is considered a structure that we declaratively control, via idempotent get+set semantics.


### 1. first, declare the entities we wish to construct

declare them as explicit domain-objects

most importantly, we must understand
- the unique, natural key upon which we can drive idempotency
- the primary, artificial key upon which we can reference the resource with in foreign keys with other entities

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/domain/objects/DeclaredStripeCustomer.ts

```ts
import { DomainEntity, DomainLiteral } from 'domain-objects';

/**
 * .what = a declarative structure which represents a Stripe Customer
 */
export interface DeclaredStripeCustomer {
  /**
   * the public stripe customer id of this customer
   */
  id?: string;

  /**
   * the email address of the customer
   *
   * note
   * - stripe does not enforce this to be a unique key
   * - however, to create a pit-of-success, this is used as the unique key with declastruct, since it is the only non-id field that we can search on
   */
  email: string;

  /**
   * then name of the customer, if set
   */
  name: null | string;

  /**
   * a description of the customer, if set
   */
  description: null | string;

  /**
   * then phone of the customer, if set
   */
  phone: null | string;

  /**
   * metadata that the customer was tagged with
   */
  metadata: null | Record<string, string>;
}

export class DeclaredStripeCustomer
  extends DomainEntity<DeclaredStripeCustomer>
  implements DeclaredStripeCustomer
{
  public static primary = ['id'] as const;
  public static unique = ['email'] as const;
  public static nested = {
    metadata: DomainLiteral,
  };
}
```


### 2. next, declare how to translate from the sdk's shape to our declared shape

declare how to translate from the sdk's shape to our declared shape

why? because its rare that the simplest way to represent a domain-entity is the way that the api has represented it, due to backwards compat && practice differences

our objective is
- make things as simple and intuitive to understand
- provide a pit of success

therefore, we always cast into our own representation, to give ourselves the flexibility to speak more clearly about entities

additionally, this enables us to cast them into `domain-object` instances, which give us explicit declarations of the distinct objects and domain-driven features like references

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/logic/cast/castToDeclaredStripeCustomer.ts
```ts
import { UnexpectedCodePathError } from 'helpful-errors';
import Stripe from 'stripe';
import { HasMetadata, omit } from 'type-fns';

import { DeclaredStripeCustomer } from '../../domain/objects/DeclaredStripeCustomer';

export const castToDeclaredStripeCustomer = (
  input: Stripe.Customer,
): HasMetadata<DeclaredStripeCustomer> => {
  return new DeclaredStripeCustomer({
    id: input.id,
    email:
      input.email ??
      UnexpectedCodePathError.throw(
        'no email found for customer. not a valid declared stripe customer',
        { input },
      ),
    description: input.description ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    metadata: (() => {
      const obj = input.metadata ? omit(input.metadata, ['exid']) : {};
      if (Object.keys(obj).length === 0) return null;
      return obj;
    })(),
  }) as HasMetadata<DeclaredStripeCustomer>;
};

```


### 3. next, declare how to get the resource from the remote repository

support get.by.unique, get.by.primary, and get.by.ref

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/logic/customer/getCustomer.ts
```ts
import { Ref, RefByPrimary, RefByUnique, isUniqueKeyRef } from 'domain-objects';
import { BadRequestError, UnexpectedCodePathError } from 'helpful-errors';
import { HasMetadata, PickOne } from 'type-fns';
import { VisualogicContext } from 'visualogic';

import { StripeApiContext } from '../../domain/constants';
import { DeclaredStripeCustomer } from '../../domain/objects/DeclaredStripeCustomer';
import { castToDeclaredStripeCustomer } from '../cast/castToDeclaredStripeCustomer';

/**
 * .what = gets a customer from stripe
 */
export const getCustomer = async (
  input: {
    by: PickOne<{
      primary: RefByPrimary<typeof DeclaredStripeCustomer>;
      unique: RefByUnique<typeof DeclaredStripeCustomer>;
      ref: Ref<typeof DeclaredStripeCustomer>;
    }>;
  },
  context: StripeApiContext & VisualogicContext,
): Promise<HasMetadata<DeclaredStripeCustomer> | null> => {
  // handle by ref
  if (input.by.ref)
    return isUniqueKeyRef({ of: DeclaredStripeCustomer })(input.by.ref)
      ? getCustomer({ by: { unique: input.by.ref } }, context)
      : getCustomer({ by: { primary: input.by.ref } }, context);

  // handle get by id
  if (input.by.primary) {
    try {
      const customer = await context.stripe.customers.retrieve(
        input.by.primary.id,
      );
      if (customer.deleted) return null;
      return castToDeclaredStripeCustomer(customer);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.message.includes('No such customer')) return null; // handle "null" responses without an error
      throw error;
    }
  }

  // handle get by email
  if (input.by.unique) {
    const {
      data: [customer, ...otherCustomers],
    } = await context.stripe.customers.list({
      email: input.by.unique.email,
    });
    if (otherCustomers.length)
      throw new BadRequestError('more than one customer for this email', {
        input,
        customers: [customer, ...otherCustomers],
      });
    if (!customer) return null;
    return castToDeclaredStripeCustomer(customer);
  }

  // otherwise, unexpected input
  throw new UnexpectedCodePathError('invalid input', { input });
};
```

and dont forget the tests!

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/logic/customer/getCustomer.integration.test.ts
```ts
import { given, then, when, useBeforeAll } from 'test-fns';
import { HasMetadata } from 'type-fns';
import { getUuid } from 'uuid-fns';

import { getStripeCredentials } from '../../__test_assets__/getStripeCredentials';
import { DeclaredStripeCustomer } from '../../domain/objects/DeclaredStripeCustomer';
import { getStripe } from '../auth/getStripe';
import { getCustomer } from './getCustomer';
import { setCustomer } from './setCustomer';

describe('getCustomer', () => {
  given('a by.primary', () => {
    when('the customer does not exist', () => {
      const stripeCustomerId = getUuid();

      then('we should get null', async () => {
        const customer = await getCustomer(
          { by: { primary: { id: stripeCustomerId } } },
          { stripe: await getStripe(getStripeCredentials()), log: console },
        );
        expect(customer).toEqual(null);
      });
    });

    when('the customer does exist', () => {
      const customerFound: HasMetadata<DeclaredStripeCustomer> = useBeforeAll(
        async () =>
          await setCustomer(
            {
              finsert: {
                email: 'svc-protools@ahbode.dev',
                name: 'svc-protools.test',
                description: 'test',
                metadata: null,
                phone: null,
              },
            },
            { stripe: await getStripe(getStripeCredentials()), log: console },
          ),
      );

      when('we attempt to get the customer', () => {
        then('we should get null', async () => {
          const customer = await getCustomer(
            { by: { primary: { id: customerFound.id } } },
            { stripe: await getStripe(getStripeCredentials()), log: console },
          );
          expect(customer?.id).toEqual(customerFound.id);
        });
      });
    });
  });
});
```

### 4. last, declare how to set the resource into the remote repository

support set via both set.finsert and set.upsert idempotent operations

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/logic/customer/setCustomer.ts

```ts
import { serialize } from 'domain-objects';
import { toHashSha256Sync } from 'hash-fns';
import { UnexpectedCodePathError } from 'helpful-errors';
import { HasMetadata, PickOne } from 'type-fns';
import {
  getResourceNameFromFileName,
  VisualogicContext,
  withLogTrail,
} from 'visualogic';

import { StripeApiContext } from '../../domain/constants';
import { DeclaredStripeCustomer } from '../../domain/objects/DeclaredStripeCustomer';
import { castToDeclaredStripeCustomer } from '../cast/castToDeclaredStripeCustomer';
import { getCustomer } from './getCustomer';

export const setCustomer = withLogTrail(
  async (
    input: PickOne<{
      finsert: DeclaredStripeCustomer;
      upsert: DeclaredStripeCustomer;
    }>,
    context: StripeApiContext & VisualogicContext,
  ): Promise<HasMetadata<DeclaredStripeCustomer>> => {
    // lookup the customer
    const customerFound = await getCustomer(
      {
        by: {
          unique: {
            email:
              input.finsert?.email ??
              input.upsert?.email ??
              UnexpectedCodePathError.throw('no email in input', { input }),
          },
        },
      },
      context,
    );

    // sanity check that if the customer exists, their id matches the user's expectations, if any
    const stripeCustomerIdExpected = input.finsert?.id || input.upsert?.id;
    if (
      customerFound &&
      stripeCustomerIdExpected &&
      stripeCustomerIdExpected !== customerFound.id
    )
      throw new UnexpectedCodePathError(
        'asked to setCustomer with a .primary=id which does not match the .unique=email',
        {
          stripeCustomerIdExpected,
          stripeCustomerIdFound: customerFound.id,
          customerFound,
        },
      );

    // if the customer was found, then handle that
    if (customerFound) {
      // if asked to finsert, then we can return it now
      if (input.finsert) return customerFound;

      // if asked to upsert, then we can update it now
      if (input.upsert)
        return castToDeclaredStripeCustomer(
          await context.stripe.customers.update(customerFound.id, {
            name: input.upsert.name ?? undefined,
            description: input.upsert.description ?? undefined,
            phone: input.upsert.phone ?? undefined,
            metadata: input.upsert.metadata ?? undefined,
          }),
        );
    }

    // otherwise, create the customer
    const customerDesired: DeclaredStripeCustomer =
      input.upsert ?? input.finsert;
    const customerCreated = await context.stripe.customers.create(
      {
        email: customerDesired.email,
        name: customerDesired.name ?? undefined,
        description: customerDesired.description ?? undefined,
        phone: customerDesired.phone ?? undefined,
        metadata: customerDesired.metadata ?? undefined,
      },
      {
        idempotencyKey: toHashSha256Sync(
          [
            // stage, // todo: pull stage from context.environment
            'v1.0.0',
            serialize({ ...customerDesired }),
          ].join(';'),
        ),
      },
    );
    return castToDeclaredStripeCustomer(customerCreated);
  },
  { name: getResourceNameFromFileName(__filename) },
);
```


and of course, the tests

ref: https://github.com/ehmpathy/declastruct-stripe-sdk/blob/1f9e2ecefb46028f75348aed8a5f9e3528eb5c1e/src/logic/customer/setCustomer.integration.test.ts
```ts
import { given, then, useBeforeAll, when } from 'test-fns';
import { getUuid } from 'uuid-fns';

import { getStripeCredentials } from '../../__test_assets__/getStripeCredentials';
import { getStripe } from '../auth/getStripe';
import { setCustomer } from './setCustomer';

const log = console;

describe('setCustomer', () => {
  given('a .finsert', () => {
    when('the customer does not exist yet', () => {
      const email = `svc-protools.test.${getUuid()}@ahbode.dev`; // random uuid => new customer

      then('we should create it', async () => {
        const customer = await setCustomer(
          {
            finsert: {
              email,
              name: 'svc-protools.test',
              description: 'test',
              metadata: null,
              phone: null,
            },
          },
          { stripe: await getStripe(getStripeCredentials()), log },
        );
        console.log(customer);
        expect(customer.id).toContain('cus_');
      });
    });

    when('the customer already exists', () => {
      const email = `svc-protools.test.${getUuid()}@ahbode.dev`; // random uuid => new customer
      const customerBefore = useBeforeAll(
        async () =>
          await setCustomer(
            {
              finsert: {
                email,
                name: 'svc-protools.test',
                description: 'test',
                metadata: null,
                phone: null,
              },
            },
            { stripe: await getStripe(getStripeCredentials()), log },
          ),
      );

      then('it should not update the customers attributes', async () => {
        const customerAfter = await setCustomer(
          {
            finsert: {
              email,
              name: 'new name',
              description: 'test',
              metadata: null,
              phone: null,
            },
          },
          { stripe: await getStripe(getStripeCredentials()), log },
        );
        expect(customerAfter.name).not.toEqual('new name');
        expect(customerAfter.name).toEqual(customerBefore.name);
      });
    });
  });
  given('a .upsert', () => {
    when('the customer does not exist yet', () => {
      const email = `svc-protools.test.${getUuid()}@ahbode.dev`; // random uuid => new customer

      then('we should create it', async () => {
        const customer = await setCustomer(
          {
            upsert: {
              email,
              name: 'svc-protools.test',
              description: 'test',
              metadata: null,
              phone: null,
            },
          },
          { stripe: await getStripe(getStripeCredentials()), log },
        );
        console.log(customer);
        expect(customer.id).toContain('cus_');
      });
    });

    when('the customer already exists', () => {
      const email = `svc-protools.test.${getUuid()}@ahbode.dev`; // random uuid => new customer
      const customerBefore = useBeforeAll(
        async () =>
          await setCustomer(
            {
              upsert: {
                email,
                name: 'svc-protools.test',
                description: 'test',
                metadata: null,
                phone: null,
              },
            },
            { stripe: await getStripe(getStripeCredentials()), log },
          ),
      );

      then('it should update the customers attributes', async () => {
        const customerAfter = await setCustomer(
          {
            upsert: {
              email,
              name: 'new name',
              description: 'test',
              metadata: null,
              phone: null,
            },
          },
          { stripe: await getStripe(getStripeCredentials()), log },
        );
        expect(customerAfter.name).toEqual('new name');
        expect(customerAfter.name).not.toEqual(customerBefore.name);
      });
    });
  });
});
```

