usecase('detect queries we should investigate optimization for')

  given('aws account with a postgres aurora db cluster')
    when('asked to find performance insights opports')
      then('queries performance insights for the account')
      then('enumerates the queries that should be looked at')
