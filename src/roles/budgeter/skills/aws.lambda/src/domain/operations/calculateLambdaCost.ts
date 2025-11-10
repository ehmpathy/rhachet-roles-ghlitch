/**
 * .what = calculate Lambda costs based on invocations, duration, and memory
 * .why = estimates costs using AWS Lambda pricing formulas
 */
import { LambdaCost } from '../objects/LambdaCost';
import { LambdaFunction } from '../objects/LambdaFunction';

// pricing constants per https://aws.amazon.com/lambda/pricing/
const COMPUTE_PRICE_X86 = 0.0000166667; // per GB-second
const COMPUTE_PRICE_ARM = 0.0000133334; // per GB-second (20% cheaper)
const REQUEST_PRICE = 0.2; // per 1M requests

export const calculateLambdaCost = (input: {
  fn: LambdaFunction;
  invocations: number;
  durationAvgMs: number;
}): LambdaCost => {
  const memoryGb = input.fn.memorySize / 1024;
  const durationSeconds = input.durationAvgMs / 1000;
  const gbSecondsPerInvocation = durationSeconds * memoryGb;
  const totalGbSeconds = gbSecondsPerInvocation * input.invocations;

  // request cost
  const requestCost = (input.invocations / 1000000) * REQUEST_PRICE;

  // compute cost (architecture-dependent)
  const isArm = input.fn.architectures.some((arch) => arch === 'arm64');
  const computePrice = isArm ? COMPUTE_PRICE_ARM : COMPUTE_PRICE_X86;
  const computeCost = totalGbSeconds * computePrice;

  const monthlyCost = requestCost + computeCost;

  return new LambdaCost({
    functionName: input.fn.functionName,
    gbSeconds: totalGbSeconds,
    requestCost,
    computeCost,
    monthlyCost,
  });
};
