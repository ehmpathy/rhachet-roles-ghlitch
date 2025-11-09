given('a command which modifies infrastructure')
  when('it does not leverage terraform')
    then('flag it as a BLOCKER')
      sothat('we manage all infrastructure via terraform')
