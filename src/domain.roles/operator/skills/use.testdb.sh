#!/usr/bin/env bash
######################################################################
# 🦺 use.testdb — start local testdb (docker postgres with schema)
#
# .what = provisions local postgres instance for integration tests
#
# .why  = integration tests require a real postgres instance with
#         the full schema applied. this skill provisions one locally.
#
# .when = use before:
#         - npm run test:integration
#         - npm run test:acceptance:locally
#         - manual database exploration
#
# usage:
#   rhx use.testdb
#   rhx use.testdb help
#
# prerequisites:
#   - docker daemon active
#
# provides:
#   - postgres 13 at localhost:7821
#   - database and schema applied from provision/schema/sql
#   - full schema migrations applied
#
# guarantee:
#   - exit 0 = testdb ready
#   - exit 1 = malfunction (docker error, schema failure)
#   - exit 2 = constraint (docker not active)
######################################################################
set -euo pipefail

# parse args (skip rhachet args, check for help)
while [[ $# -gt 0 ]]; do
  case $1 in
    --skill|--repo|--role)
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🦺 use.testdb"
      echo ""
      echo "usage:"
      echo "  rhx use.testdb"
      echo ""
      echo "prerequisites:"
      echo "  - docker daemon active"
      echo ""
      echo "provides:"
      echo "  - postgres at localhost:7821"
      echo "  - schema from provision/schema/sql applied"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# check docker is active
if ! docker info >/dev/null 2>&1; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 use.testdb"
  echo "   ├─ docker daemon not active"
  echo "   └─ hint: start docker desktop or 'systemctl start docker'"
  exit 2
fi

echo "🐈 chartin course..."
echo ""
echo "🦺 use.testdb"

# remove stale container by name
echo "   ├─ clear stale containers..."
docker rm -f jobsdb 2>/dev/null || true
docker rm -f testdb 2>/dev/null || true
docker rm -f ghlitch-testdb 2>/dev/null || true

# start the testdb
# .note = start:testdb uses `up -d --wait`, which blocks until the compose
#         healthcheck (pg_isready) reports healthy — so by the time this
#         returns, postgres truly accepts connections (no false "ready")
echo "   └─ start testdb..."
npm run start:testdb

echo ""
echo "🐈 caught it!"
echo ""
echo "🦺 use.testdb"
echo "   └─ testdb ready at localhost:7821"
