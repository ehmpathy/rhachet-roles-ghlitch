objective: detect which endpoints have behaviors that would ping the database at a regular cadence

# product.narrative

we've got a postgres serverless database which should scale down to 0.acu when not in use

in dev, we'd like that 0.acu to occur always;
- 0.acu = $0/mo => effic++

however, it's not going to 0.acu today

likely because we've got some crontasks polling the resources.

we need to detect and disable the culprits;

nearterm, in a systematic way so that we can repeat the same process when this inevitably recurrs.

longterm, we should also monitor and alarm, so we can halt this before it impacts a bill


----


# arch.criteria

- analyze all lambdas
- identify the likely crontasks

# arch.proposal

1. for each lambda, detect crontask triggers


-----


# reflection

originally, thought we should use cloudwatch queries to do so

however, through writeout of arch.criteria.behavior, it became instantly clear that
- we were only looking for crontasks

=>

made it immediately clear that lambdas had a direct api call that we could use to detect them
