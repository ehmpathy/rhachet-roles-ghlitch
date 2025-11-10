/**
 * .what = complete Lambda expense evaluation report
 * .why = represents the full analysis output including summary and per-function expenses
 */
import { DomainLiteral } from 'domain-objects';
import { AwsAccount } from './AwsAccount';
import { LambdaExpense } from './LambdaExpense';

export interface LambdaExpenseEvaluation {
  account: AwsAccount;
  evaluationDate: string;
  period: {
    days: number;
    from: string;
    to: string;
  };
  memoryQueryThreshold: number;
  summary: {
    totalFunctions: number;
    functionsWithUsage: number;
    totalInvocations: number;
    totalGbSeconds: number;
    architecture: {
      x86_64: number;
      arm64: number;
    };
  };
  costs: {
    requestCost: number;
    computeCost: number;
    totalMonthlyCost: number;
    serviceCostFromExplorer: number;
    currency: string;
  };
  functions: LambdaExpense[];
}
export class LambdaExpenseEvaluation extends DomainLiteral<LambdaExpenseEvaluation> implements LambdaExpenseEvaluation {
  public static nested = { account: AwsAccount, functions: LambdaExpense } as const;
}
