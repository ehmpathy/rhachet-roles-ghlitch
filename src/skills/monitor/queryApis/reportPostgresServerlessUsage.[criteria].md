given('an aws account with a postgres aurora serverless instance')
  when('asked to report the usage')
    then('should emit a histogram of the min, max, avg ACU used per hour)
    then('should elit a summary of the utilization, verbally')
