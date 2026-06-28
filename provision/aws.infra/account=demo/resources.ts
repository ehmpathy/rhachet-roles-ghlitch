/**
 * .what = aws resources for rhachet-roles-ghlitch test account
 * .why = enables real integration tests for aws.cloudwatch.logs.query skill
 */
import type { DeclastructProvider } from 'declastruct';
import {
  DeclaredAwsIamRole,
  DeclaredAwsIamRolePolicyAttachedInline,
  DeclaredAwsLambda,
  genDeclaredAwsLambdaCode,
  getDeclastructAwsProvider,
} from 'declastruct-aws';
import { type DomainEntity, RefByUnique } from 'domain-objects';
import { keyrack } from 'rhachet/keyrack';

// source aws credentials from keyrack
keyrack.source({ env: 'test', owner: 'ehmpath', mode: 'lenient' });

export const getProviders = async (): Promise<DeclastructProvider[]> => [
  await getDeclastructAwsProvider(
    {},
    {
      log: {
        info: () => {},
        debug: () => {},
        warn: console.warn,
        error: console.error,
      },
    },
  ),
];

export const getResources = async (): Promise<DomainEntity<any>[]> => {
  // declare iam role for lambda execution
  const lambdaRole = DeclaredAwsIamRole.as({
    name: 'rhachet-roles-ghlitch-test-role',
    path: '/',
    description: 'role for rhachet-roles-ghlitch integration test lambda',
    policies: [
      {
        effect: 'Allow',
        principal: { service: 'lambda.amazonaws.com' },
        action: 'sts:AssumeRole',
      },
    ],
    tags: { managedBy: 'declastruct' },
  });

  // declare inline policy for CloudWatch Logs permissions
  const lambdaRolePolicy = DeclaredAwsIamRolePolicyAttachedInline.as({
    name: 'cloudwatch-logs',
    role: RefByUnique.as<typeof DeclaredAwsIamRole>(lambdaRole),
    document: {
      statements: [
        {
          effect: 'Allow',
          action: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          resource: '*',
        },
      ],
    },
  });

  // declare test lambda function to generate cloudwatch logs
  const echoLambdaTest = DeclaredAwsLambda.as({
    name: 'rhachet-roles-ghlitch-test-echo',
    runtime: 'nodejs20.x',
    handler: 'handler.handler',
    timeout: 30,
    memory: 128,
    role: RefByUnique.as<typeof DeclaredAwsIamRole>(lambdaRole),
    envars: { NODE_ENV: 'test' },
    code: genDeclaredAwsLambdaCode({
      zipUri: 'provision/aws.infra/account=demo/.assets/handler.zip',
    }),
    tags: { managedBy: 'declastruct', purpose: 'integration-test' },
  });

  // declare prep lambda (modern env convention: -prep suffix)
  const echoLambdaPrep = DeclaredAwsLambda.as({
    name: 'rhachet-roles-ghlitch-prep-echo',
    runtime: 'nodejs20.x',
    handler: 'handler.handler',
    timeout: 30,
    memory: 128,
    role: RefByUnique.as<typeof DeclaredAwsIamRole>(lambdaRole),
    envars: { NODE_ENV: 'prep' },
    code: genDeclaredAwsLambdaCode({
      zipUri: 'provision/aws.infra/account=demo/.assets/handler.zip',
    }),
    tags: { managedBy: 'declastruct', purpose: 'integration-test' },
  });

  // declare dev lambda for different service (historic env convention: -dev suffix)
  // .note = demonstrates that --env prep can find logs from services still on -dev
  const echoLambdaDev = DeclaredAwsLambda.as({
    name: 'svc-ghlitch-demo-dev-echo',
    runtime: 'nodejs20.x',
    handler: 'handler.handler',
    timeout: 30,
    memory: 128,
    role: RefByUnique.as<typeof DeclaredAwsIamRole>(lambdaRole),
    envars: { NODE_ENV: 'dev' },
    code: genDeclaredAwsLambdaCode({
      zipUri: 'provision/aws.infra/account=demo/.assets/handler.zip',
    }),
    tags: { managedBy: 'declastruct', purpose: 'integration-test' },
  });

  return [
    lambdaRole,
    lambdaRolePolicy,
    echoLambdaTest,
    echoLambdaPrep,
    echoLambdaDev,
  ];
};
