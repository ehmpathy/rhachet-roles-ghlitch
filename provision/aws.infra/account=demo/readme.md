# aws.infra/account=demo

aws resources for rhachet-roles-ghlitch integration tests in the test account.

## resources

- `rhachet-roles-ghlitch-test-role` — iam role for lambda execution
- `rhachet-roles-ghlitch-test-echo` — test env lambda (echoes input, logs to CloudWatch)
- `rhachet-roles-ghlitch-prep-echo` — prep env lambda (modern -prep suffix)
- `svc-ghlitch-demo-dev-echo` — dev env lambda (historic -dev suffix, different service prefix)

## prerequisites

1. aws credentials for the test account
2. declastruct-aws installed (already in dependencies)

## build handler

bundle the handler before deploy:

```sh
cd provision/aws.infra/account=demo/.assets
zip handler.zip handler.js
```

## plan

preview changes without apply. the skill unlocks keyrack and writes the plan to
`<wish>.plan.json` beside the wish:

```sh
rhx provision.declastruct --wish provision/aws.infra/account=demo/resources.ts --env test --mode plan
```

## apply

apply the reviewed plan to create resources:

```sh
rhx provision.declastruct --wish provision/aws.infra/account=demo/resources.ts --env test --mode apply
```

## verify

invoke the lambda to verify:

```sh
aws lambda invoke \
  --function-name rhachet-roles-ghlitch-test-echo \
  --payload '{"message":"hello"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

## why

these lambdas generate CloudWatch log groups that the aws.cloudwatch.logs.query skill can query in integration tests. without deployed lambdas, there are no log groups to test against.

## dev vs prep

historically, services used `-dev` suffix for pre-production environments. the modern convention uses `-prep`. both exist here to demonstrate that `--env prep` can find logs from services on either convention:

- `rhachet-roles-ghlitch-prep-echo` — modern `-prep` suffix
- `svc-ghlitch-demo-dev-echo` — historic `-dev` suffix (different service prefix)
