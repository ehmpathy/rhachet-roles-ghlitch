
usecase.1(infer lambda crontasks from invocation behavior)
- given('exists lambdas, with and without crontasks')
  - when('plan: asked to identify lambdas with crontasks')
    - then('queries the aws cloudwatch invocation metrics within an each minute grain, for the past 24 hrs')
    - then('enumerates all of the lambdas that are invoked at a regular frequency')

