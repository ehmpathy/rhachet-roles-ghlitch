/**
 * sanity check that unit tests are only run the 'test' environment
 *
 * usecases
 * - prevent polluting prod state with test data
 * - prevent executing financially impacting mutations
 */
if (
  (process.env.NODE_ENV !== 'test' ||
    (process.env.CONFIG && process.env.CONFIG !== 'test')) &&
  process.env.I_KNOW_THE_RISKS !== 'true'
)
  throw new Error(`unit-test config must be 'test'`);
