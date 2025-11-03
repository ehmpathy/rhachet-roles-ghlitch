given('an aws account with a postgres aurora serverless instance')
  when('asked to verify it could scale to zero')
    then('it <review>.level=blocker that the min acu is set to 0')
    then('it <review>.level=nitpick that the timeout is 5min')
  when('asked to verify that it has regularly scaled to zero')
    then('it <review>.level=blocker whether it has in the past week')
    then('it <review>.level=nitpick whether it has in the past 24hrs')
---

where
- <assure> = throw error if not true

