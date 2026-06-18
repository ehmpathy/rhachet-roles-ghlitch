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

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
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
fi

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

# export AWS credentials from keyrack (needed for SSM params at schema apply)
echo "   ├─ export AWS credentials..."
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_SSO_PROFILE=$(rhx keyrack get --key AWS_PROFILE --owner ehmpath --env prep --value 2>/dev/null || echo "")
  if [[ -z "$AWS_SSO_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🦺 use.testdb"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=prep"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env prep"
    exit 1
  fi
  if ! eval "$(aws configure export-credentials --profile "$AWS_SSO_PROFILE" --format env 2>/dev/null)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🦺 use.testdb"
    echo "   ├─ absent credentials from profile $AWS_SSO_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_SSO_PROFILE"
    exit 1
  fi
  unset AWS_PROFILE
fi

# remove stale container by name (docker:clear only removes by port)
echo "   ├─ clear stale containers..."
docker rm -f jobsdb 2>/dev/null || true
docker rm -f testdb 2>/dev/null || true

# start the testdb
echo "   └─ start testdb..."
ACCESS=prep CONFIG=test npm run start:testdb

echo ""
echo "🐈 caught it!"
echo ""
echo "🦺 use.testdb"
echo "   └─ testdb ready at localhost:7821"
